import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { computeMetadata, createImageApp, createMetaApp } from '@lazy-ease/server'
import { Hono } from 'hono'
import { ensureDemoImages } from './scripts/generate-images.js'
import { DEMO_PARAMS, profileFromQuery } from './src/throttle.js'

const PORT = 3001
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'images')

await ensureDemoImages(root)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The image app rejects unknown parameters, so the demo's own (`run`, the
 * throttle settings) are removed before it sees the request. The rest keeps
 * its original order, so a non-canonical URL is still a 400. Returns
 * undefined when there is nothing to remove.
 */
function withoutDemoParams(request: Request): Request | undefined {
  const url = new URL(request.url)
  const pairs = url.search.slice(1).split('&').filter(Boolean)
  const kept = pairs.filter((pair) => !DEMO_PARAMS.has(decodeURIComponent(pair.split('=')[0]!)))
  if (kept.length === pairs.length) return undefined
  url.search = kept.length > 0 ? `?${kept.join('&')}` : ''
  return new Request(url, request)
}

/**
 * Simulates a slow network for the demo: waits `latency` ms, then streams the
 * body in small chunks at the given bandwidth so images arrive progressively.
 */
async function throttled(response: Response, profile: { latency: number; kbps: number }): Promise<Response> {
  await sleep(profile.latency)
  if (!response.body) return response

  const ticksPerSecond = 20
  const bytesPerTick = Math.max(1, Math.round((profile.kbps * 1000) / 8 / ticksPerSecond))
  const body = new Uint8Array(await response.arrayBuffer())
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= body.length) return controller.close()
      await sleep(1000 / ticksPerSecond)
      controller.enqueue(body.subarray(offset, (offset += bytesPerTick)))
    },
  })
  return new Response(stream, { status: response.status, headers: response.headers })
}

const app = new Hono()

// The throttle applies to the image route only (spec 13). A request with demo
// parameters goes through the app again without them, so it reaches the
// image route below exactly as a canonical request would.
app.use('/_img/*', async (c, next) => {
  const canonical = withoutDemoParams(c.req.raw)
  if (!canonical) return next()
  const response = await app.fetch(canonical)
  const profile = profileFromQuery(c.req.query())
  return profile ? throttled(response, profile) : response
})
app.route('/_img', createImageApp({ root }))

// Local metadata for tooling (spec 12.2); the demo itself uses /api/images.
app.route('/_meta', createMetaApp({ root }))

// Untouched originals for the external-image section. An absolute URL is
// external to the component, so these are loaded as is.
app.get('/external/:file', async (c) => {
  const file = c.req.param('file')
  if (!/^[\w-]+\.jpg$/.test(file)) return c.notFound()
  const body = await readFile(path.join(root, file)).catch(() => undefined)
  if (!body) return c.notFound()
  return c.body(body, 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' })
})

// Stands in for a CMS or build step (spec 12.3): the image list ships with the
// metadata, so placeholders render on first paint without any request.
let imageList: Promise<unknown[]> | undefined
async function listImages() {
  const files = (await readdir(root)).filter((file) => /\.(jpe?g|png|webp|avif)$/i.test(file)).sort()
  return Promise.all(
    files.map(async (file) => ({ src: `/${file}`, file, ...(await computeMetadata(path.join(root, file))) })),
  )
}

app.get('/api/images', async (c) => c.json(await (imageList ??= listImages())))

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Image server on http://localhost:${PORT}`)
})
