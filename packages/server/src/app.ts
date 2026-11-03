import { createHash } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { DEFAULT_QUALITIES, DEFAULT_RATIOS, DEFAULT_WIDTHS, formatNumber, parseImageQuery } from './contract.js'
import {
  DEFAULT_MAX_INPUT_PIXELS,
  createRenderQueue,
  mapSharpError,
  render,
  withTimeout,
  type Encoded,
} from './render.js'
import { resolveSource } from './source.js'

export interface ImageServerOptions {
  /** Directory the source images are read from. */
  root: string
  /** Width ladder. Must match the loader's. */
  widths?: readonly number[]
  /** Ratio ladder. Must match the loader's. */
  ratios?: readonly number[]
  /** Allowed `q` values. Must match the loader's. The first one is used when `q` is absent. */
  qualities?: readonly number[]
  /** Sources larger than this many bytes are a 413, checked before decoding. Default 32 MB. */
  maxFileSize?: number
  /** Sources with more pixels than this are a 413. Default 50 MP. */
  maxInputPixels?: number
  /** Per-render timeout in ms; a timeout is a 504. Default 10 s. */
  timeout?: number
  /** Renders running at once. Default: the number of CPUs. */
  concurrency?: number
  /** Number of encoded images kept in memory. 0 disables the cache. */
  cacheSize?: number
}

const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * Hono app with one route, `GET /{src path}?ar&fmt&q&v&w` (spec 12.1). Mount
 * it at the loader's `baseUrl`, e.g. `app.route('/_img', createImageApp(…))`.
 * `HEAD` is answered by the same route.
 */
export function createImageApp({
  root,
  widths = DEFAULT_WIDTHS,
  ratios = DEFAULT_RATIOS,
  qualities = DEFAULT_QUALITIES,
  maxFileSize = 32 * 1024 * 1024,
  maxInputPixels = DEFAULT_MAX_INPUT_PIXELS,
  timeout = 10_000,
  concurrency = availableParallelism(),
  cacheSize = 200,
}: ImageServerOptions): Hono {
  if (qualities.length === 0) throw new RangeError('qualities must not be empty')
  const app = new Hono()
  const cache = new Map<string, Encoded>()
  const queue = createRenderQueue(concurrency)
  const ladders = { widths, ratios, qualities }

  const remember = (key: string, value: Encoded) => {
    if (cacheSize <= 0) return
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
  }
  const recall = (key: string) => {
    const value = cache.get(key)
    if (value) remember(key, value)
    return value
  }

  app.get('/:path{.+}', async (c) => {
    const url = c.req.url
    const queryStart = url.indexOf('?')
    // Validate the raw string: Hono's parsed query would hide order, duplicates and encoding.
    const params = parseImageQuery(queryStart === -1 ? '' : url.slice(queryStart + 1), ladders)
    const source = await resolveSource(root, c.req.param('path'))
    if (source.size > maxFileSize) throw new HTTPException(413, { message: 'Source file is too large' })

    // `v` does not change the bytes, so it is not part of the render key.
    const key = [
      source.file,
      formatNumber(params.width),
      params.aspectRatio === undefined ? '' : formatNumber(params.aspectRatio),
      formatNumber(params.quality),
      params.format,
    ].join('|')
    const etag = `"${createHash('sha256').update(`${key}|${source.mtimeMs}`).digest('base64url').slice(0, 32)}"`
    const headers = {
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }

    if (matches(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers)

    const cacheKey = `${key}|${source.mtimeMs}`
    let encoded = recall(cacheKey)
    if (!encoded) {
      encoded = await queue
        .run(cacheKey, () => withTimeout(render(source.file, params, { maxInputPixels, timeout }), timeout))
        .catch((error: unknown) => {
          throw mapSharpError(error)
        })
      remember(cacheKey, encoded)
    }

    return c.body(encoded.body as Uint8Array<ArrayBuffer>, 200, {
      ...headers,
      'Content-Type': encoded.type,
      'Content-Length': String(encoded.body.byteLength),
    })
  })

  return app
}

/** `If-None-Match` uses the weak comparison, so `W/"x"` matches `"x"`. */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').some((tag) => {
    const trimmed = tag.trim()
    return trimmed === '*' || trimmed.replace(/^W\//, '') === etag
  })
}
