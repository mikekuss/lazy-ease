import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { computeMetadata, createImageApp } from '@lazy-ease/server'
import { build, type BuildOptions } from 'esbuild'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import sharp from 'sharp'
import { cssText } from '../../packages/vanilla/src/css.js'
import { buildScript } from '../../packages/vanilla/scripts/bundle.mjs'
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

await mkdir(root, { recursive: true })
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
const client = await build({ ...shared, entryPoints: [path.join(here, 'src', 'client.tsx')], write: false, format: 'iife' })
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

app.use('/_img/*', async (c, next) => {
  const match = /^(\d+):(\d+)$/.exec(getCookie(c, 'e2e-throttle') ?? '')
  await next()
  if (match) c.res = await throttled(c.res, Number(match[1]), Number(match[2]))
})
app.route('/_img', createImageApp({ root }))

app.get('/health', (c) => c.text('ok'))
app.get('/assets/lazy-ease.min.js', (c) => c.body(vanillaJs, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }))
app.get('/assets/lazy-ease.css', (c) => c.body(cssText, 200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }))
app.get('/vanilla', (c) => c.html(vanillaHtml))
app.get('/client.js', (c) => c.body(clientJs, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }))
app.get('/:page', (c) => {
  const page = c.req.param('page')
  if (!Object.hasOwn(pages, page)) return c.notFound()
  return c.html(renderPage({ page, images }))
})

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`E2E fixture on http://127.0.0.1:${PORT}`)
})
