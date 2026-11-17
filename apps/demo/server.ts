import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { DEFAULT_RATIOS, formatNumber } from '@lazy-ease/core'
import {
  computeMetadata,
  createImageApp,
  createMetaApp,
  diskStorage,
  memoryStorage,
  signCropToken,
  type SourcePolicy,
  type VariantStorage,
} from '@lazy-ease/server'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { ensureDemoImages } from './scripts/generate-images.js'
import { EXTRA_CROPS, isPrivate, PRIVATE } from './src/catalog.js'
import { DEMO_PARAMS, profileFromQuery } from './src/throttle.js'

const PORT = Number(process.env.SERVER_PORT) || 3001
const demoDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(demoDir, 'images')
// `--serve dist-live`: also serve the live build (`pnpm --filter demo start`).
const serveIndex = process.argv.indexOf('--serve')
const serveDir = serveIndex > 0 ? process.argv[serveIndex + 1] : undefined

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

// --- Viewer sessions and crop tokens (the shadow-panel case) ---------------

// A signed-in viewer is a random session id in an HttpOnly cookie. The
// image app's `authorize` checks it before every private response, cache
// hits and 304s included, so signing out ends access at once.
const SESSION = 'le-demo-session'
const sessions = new Set<string>()
const signedIn = (request: Request) => {
  const id = /(?:^|;\s*)le-demo-session=([\w-]+)/.exec(request.headers.get('cookie') ?? '')?.[1]
  return id !== undefined && sessions.has(id)
}
// One key per server start; tokens are minted here, never in the browser.
const KID = 'demo'
const keys = { [KID]: randomBytes(32) }

// --- Storage: the server's own diskStorage()/memoryStorage() --------------

const STORAGE_PRESETS = {
  /** The default: 1 GB on disk in .cache/lazy-ease. */
  disk: () => diskStorage(),
  /** A small disk cache, so eviction is easy to see. */
  small: () => diskStorage({ dir: path.join(demoDir, '.cache', 'lazy-ease-small'), maxBytes: 2 * 1024 ** 2, maxSourceBytes: 400 * 1024 }),
  /** In the process only, empty after a restart. */
  memory: () => memoryStorage(),
  /** Nothing kept: every request renders. */
  off: () => memoryStorage({ maxBytes: 0 }),
} satisfies Record<string, () => VariantStorage>
type StoragePreset = keyof typeof STORAGE_PRESETS

/** Records whether a request's lookup hit, for the X-Demo-Cache header. */
const lookups = new AsyncLocalStorage<{ result?: 'hit' | 'miss' }>()
function observed(storage: VariantStorage): VariantStorage {
  return {
    get: async (key) => {
      const value = await storage.get(key)
      const context = lookups.getStore()
      if (context) context.result = value ? 'hit' : 'miss'
      return value
    },
    put: (key, value, source) => storage.put(key, value, source),
    flush: () => storage.flush(),
    close: () => storage.close(),
    get dir() {
      return storage.dir
    },
  }
}

const policy = ({ path: source }: { path: string }): SourcePolicy => {
  // A private source admits no crop without a token; the panel's square has one.
  if (isPrivate(source)) return { private: true, crops: [{}] }
  // The default crops (uncropped, centered ladder ratios) plus the recipes' focal crops.
  return { crops: [{}, ...DEFAULT_RATIOS.map((aspectRatio) => ({ aspectRatio })), ...(EXTRA_CROPS[source] ?? [])] }
}

let preset: StoragePreset = 'disk'
let storage = observed(STORAGE_PRESETS[preset]())
const imageApp = (store: VariantStorage) =>
  createImageApp({ root, storage: store, policy, keys, authorize: (request) => signedIn(request) })
let images = imageApp(storage)

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
// Canonical requests only (the one above returns early): did the storage have it?
app.all('/_img/*', async (c) => {
  const context: { result?: 'hit' | 'miss' } = {}
  const url = new URL(c.req.url)
  url.pathname = url.pathname.slice('/_img'.length)
  const response = await lookups.run(context, () => images.fetch(new Request(url, c.req.raw)))
  if (!context.result) return response
  const headers = new Headers(response.headers)
  headers.set('X-Demo-Cache', context.result)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
})

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
// Private sources are not listed.
let imageList: Promise<unknown[]> | undefined
async function listImages() {
  const files = [
    ...(await readdir(root)),
    ...(await readdir(path.join(root, 'extra'))).map((file) => `extra/${file}`),
  ].filter((file) => /(^|\/)[^./][^/]*\.(jpe?g|png|webp|avif)$/i.test(file))
  return Promise.all(
    files.sort().map(async (file) => ({ src: `/${file}`, file, ...(await computeMetadata(path.join(root, file))) })),
  )
}
app.get('/api/images', async (c) => c.json(await (imageList ??= listImages())))

app.get('/api/session', (c) => c.json({ signedIn: signedIn(c.req.raw) }))
app.post('/api/session', (c) => {
  const id = randomBytes(16).toString('base64url')
  sessions.add(id)
  setCookie(c, SESSION, id, { httpOnly: true, sameSite: 'Strict', path: '/' })
  return c.json({ signedIn: true })
})
app.delete('/api/session', (c) => {
  const id = getCookie(c, SESSION)
  if (id) sessions.delete(id)
  deleteCookie(c, SESSION, { path: '/' })
  return c.json({ signedIn: false })
})

/** What a template gets for the private image: revision and a crop token, after the viewer check. */
let privateRevision: Promise<string> | undefined
app.get('/api/private', async (c) => {
  if (!signedIn(c.req.raw)) return c.json({ error: 'Sign in first' }, 403, { 'Cache-Control': 'no-store' })
  const revision = await (privateRevision ??= computeMetadata(path.join(root, PRIVATE.src)).then((meta) => meta.revision))
  const token = signCropToken({ tenant: 'default', source: PRIVATE.src, revision, ar: formatNumber(1) }, KID, keys[KID]!)
  return c.json({ src: PRIVATE.src, version: revision, token }, 200, { 'Cache-Control': 'no-store' })
})

app.get('/api/storage', async (c) => {
  // Background writes have landed, so the next request sees them.
  await storage.flush()
  return c.json({ preset, presets: Object.keys(STORAGE_PRESETS), dir: storage.dir })
})
let switching = Promise.resolve()
app.put('/api/storage', async (c) => {
  const next = (await c.req.json().catch(() => ({}))) as { preset?: string }
  if (!next.preset || !(next.preset in STORAGE_PRESETS)) return c.json({ error: 'Unknown preset' }, 400)
  switching = switching.then(async () => {
    // A disk directory may only be opened again once its close() has settled.
    const old = storage
    await old.close()
    preset = next.preset as StoragePreset
    storage = observed(STORAGE_PRESETS[preset]())
    images = imageApp(storage)
  })
  await switching
  return c.json({ preset, dir: storage.dir })
})

if (serveDir) {
  // Imported only here: loaded at startup it stalls the server under
  // `tsx watch` inside `concurrently` on Windows (pnpm dev).
  const { serveStatic } = await import('@hono/node-server/serve-static')
  const dir = path.relative(process.cwd(), path.resolve(demoDir, serveDir))
  app.use('/*', serveStatic({ root: dir }))
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Image server on http://localhost:${PORT}${serveDir ? `, serving ${serveDir}` : ''}`)
})

const shutdown = () => void storage.close().then(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
