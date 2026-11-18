import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { computeMetadata, createImageApp, memoryStorage } from '@lazy-ease/server'
import { build, type BuildOptions } from 'esbuild'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import sharp from 'sharp'
import { cssText } from '@lazy-ease/vanilla/css'
import { buildScript } from '../../packages/vanilla/scripts/bundle.mjs'
import { FOCUS } from './src/focus.js'
import type { FixtureImage, PageData } from './src/pages.js'

const PORT = Number(process.env.PORT) || 3100
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.cache', 'images')

/** A noisy gradient, so the ThumbHash has a distinct average color. */
async function writeSource(file: string, width: number, height: number): Promise<void> {
  if (await stat(file).catch(() => undefined)) return
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const noise = () => (Math.random() - 0.5) * 90
      pixels[i] = 200 - (120 * x) / width + noise()
      pixels[i + 1] = 60 + (100 * y) / height + noise()
      pixels[i + 2] = 40 + noise()
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toFile(file)
}

async function fixtureImage(file: string, width: number, height: number): Promise<FixtureImage> {
  const full = path.join(root, file)
  await writeSource(full, width, height)
  return { src: `/${file}`, ...(await computeMetadata(full)) }
}

/** White, with a blue dot of radius 24 at (70 %, 60 %): where it lands shows the crop. */
async function focusImage(file: string): Promise<FixtureImage> {
  const full = path.join(root, file)
  if (!(await stat(full).catch(() => undefined))) {
    const dot = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#0000ff"/></svg>')
    await sharp({ create: { width: 1600, height: 500, channels: 3, background: '#ffffff' } })
      .composite([{ input: dot, left: 1120 - 24, top: 300 - 24 }])
      .png()
      .toFile(full)
  }
  return { src: `/${file}`, ...(await computeMetadata(full)) }
}

/** Pass-through originals: an SVG and a two-frame GIF the loader must not resize. */
async function originals(): Promise<void> {
  await mkdir(path.join(root, 'extra'), { recursive: true })
  const svg = path.join(root, 'extra', 'mark.svg')
  if (!(await stat(svg).catch(() => undefined))) {
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#0a7"/></svg>')
  }
  const gif = path.join(root, 'extra', 'blink.gif')
  if (!(await stat(gif).catch(() => undefined))) {
    const frame = (background: string) => sharp({ create: { width: 90, height: 60, channels: 3, background } }).png().toBuffer()
    await sharp([await frame('#ff0000'), await frame('#0000ff')], { join: { animated: true } })
      .gif({ delay: [200, 200], loop: 0 })
      .toFile(gif)
  }
}

await mkdir(root, { recursive: true })
await originals()
const images: PageData['images'] = {
  photo: await fixtureImage('photo.jpg', 2400, 1600),
  small: await fixtureImage('small.jpg', 500, 400),
  copies: await Promise.all([1, 2, 3].map((n) => fixtureImage(`copy-${n}.jpg`, 1200, 800))),
  focus: await focusImage('focus.png'),
}

// Both sides are bundled with esbuild: tsx applies the JSX setting only to
// files its tsconfig includes, not to the workspace packages' sources.
// Development builds, so the component's dev warnings are on.
const shared: BuildOptions = {
  bundle: true,
  target: 'es2022',
  jsx: 'automatic',
  conditions: ['source'],
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
}
const client = await build({
  ...shared,
  entryPoints: [path.join(here, 'src', 'client.tsx')],
  write: false,
  format: 'iife',
})
const clientJs = client.outputFiles[0]!.text

const ssrFile = path.join(here, '.cache', 'ssr.mjs')
await build({
  ...shared,
  entryPoints: [path.join(here, 'src', 'ssr.tsx')],
  outfile: ssrFile,
  platform: 'node',
  format: 'esm',
  // One React for the bundle and react-dom/server.
  external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
})
const { pages, renderPage } = (await import(pathToFileURL(ssrFile).href)) as typeof import('./src/ssr.js')

// The vanilla assets at the paths the recipes use. The script is the
// published build from packages/vanilla/scripts/bundle.mjs, from source:
// CI's e2e job does not build the packages.
const vanillaJs = (await buildScript({ conditions: ['source'], write: false })).outputFiles[0]!.text
const vanillaHtml = await readFile(path.join(here, 'static', 'vanilla.html'), 'utf8')

// Core as an ES module, for specs that drive the controller directly.
const coreJs = (await build({ ...shared, stdin: { contents: "export * from '@lazy-ease/core'", resolveDir: here }, write: false, format: 'esm' }))
  .outputFiles[0]!.text
// Vanilla with its own copy of core, as a separately bundled ES module: a
// second bundle next to the IIFE, sharing nothing with it but the page.
const vanillaEsm = (
  await build({
    ...shared,
    stdin: { contents: "export * from '@lazy-ease/core'; export { enhance, readOptions } from '@lazy-ease/vanilla'", resolveDir: here },
    write: false,
    format: 'esm',
  })
).outputFiles[0]!.text
const coreHtml = '<!doctype html><meta charset="utf-8"><title>core</title><script type="module">import * as core from "/assets/core.js"; window.core = core</script>'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Streams the body in small chunks spread over `duration` ms, so the browser
 * receives the image progressively. A duration rather than a bandwidth, since
 * engines get different formats and sizes. Set per browser context with the
 * `e2e-throttle` cookie (`{latency}:{duration}`), which keeps the image URLs
 * canonical.
 */
async function throttled(response: Response, latency: number, duration: number): Promise<Response> {
  await sleep(latency)
  if (!response.body || response.status !== 200) return response
  const tick = 50
  const body = new Uint8Array(await response.arrayBuffer())
  const bytesPerTick = Math.max(1, Math.ceil(body.length / Math.max(1, duration / tick)))
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= body.length) return controller.close()
      await sleep(tick)
      controller.enqueue(body.subarray(offset, (offset += bytesPerTick)))
    },
  })
  return new Response(stream, { status: response.status, headers: response.headers })
}

const app = new Hono()

// Server-side request log per browser context: a context sends `x-e2e-run`
// with every request (Playwright extraHTTPHeaders), and /_e2e/log/{run} lists
// what reached the server, 304s included. The ground truth for request counts,
// independent of what the browser reports.
const logs = new Map<string, { url: string; status: number }[]>()
app.use('*', async (c, next) => {
  await next()
  const run = c.req.header('x-e2e-run')
  if (!run || c.req.path.startsWith('/_e2e/')) return
  const url = new URL(c.req.url)
  let log = logs.get(run)
  if (!log) logs.set(run, (log = []))
  log.push({ url: url.pathname + url.search, status: c.res.status })
})
app.get('/_e2e/images', (c) => c.json(images))
app.get('/_e2e/log/:run', (c) => c.json(logs.get(c.req.param('run')) ?? []))

// Lab pages: a spec stores an HTML document and opens /lab/{id}. Served
// without page.route, which would turn off the browser's HTTP cache.
const labPages = new Map<string, string>()
app.put('/_e2e/lab/:id', async (c) => {
  labPages.set(c.req.param('id'), await c.req.text())
  return c.body(null, 204)
})
app.get('/lab/:id', (c) => {
  const html = labPages.get(c.req.param('id'))
  return html === undefined ? c.notFound() : c.html(html, 200, { 'Cache-Control': 'no-store' })
})

app.use('/_img/*', async (c, next) => {
  const match = /^(\d+):(\d+)$/.exec(getCookie(c, 'e2e-throttle') ?? '')
  await next()
  if (match) c.res = await throttled(c.res, Number(match[1]), Number(match[2]))
})
// The focus fixture's upload record: its server crops are centered on FOCUS (spec 6.1, backend.md).
// RAM-only, so every run renders from the fixtures it just generated.
// q=60 besides the default 75: the second bundle in the two-bundle test writes it, so a double attach shows.
app.route('/_img', createImageApp({ root, storage: memoryStorage(), qualities: [60, 75], policy: ({ path }) => (path === images.focus.src ? { focalPoint: FOCUS } : {}) }))

app.get('/health', (c) => c.text('ok'))
// `?delay={ms}` holds the script back, `?status={code}` fails it: a script that arrives late or not at all.
app.get('/assets/lazy-ease.min.js', async (c) => {
  const delay = Number(c.req.query('delay'))
  if (delay > 0) await sleep(Math.min(delay, 10_000))
  const status = Number(c.req.query('status'))
  if (status >= 400) return c.text('Script failed', status as 500, { 'Cache-Control': 'no-store' })
  return c.body(vanillaJs, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
})
app.get('/assets/vanilla.js', (c) => c.body(vanillaEsm, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }))
app.get('/assets/lazy-ease.css', (c) => c.body(cssText, 200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }))
app.get('/vanilla', (c) => c.html(vanillaHtml))
app.get('/assets/core.js', (c) => c.body(coreJs, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }))
app.get('/core', (c) => c.html(coreHtml))
app.get('/client.js', (c) => c.body(clientJs, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }))
app.get('/:page', (c) => {
  const page = c.req.param('page')
  if (!Object.hasOwn(pages, page)) return c.notFound()
  return c.html(renderPage({ page, images }))
})

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`E2E fixture on http://127.0.0.1:${PORT}`)
})
