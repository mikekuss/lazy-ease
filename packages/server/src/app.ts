import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  DEFAULT_QUALITIES,
  DEFAULT_RATIOS,
  DEFAULT_WIDTHS,
  OUTPUT_FORMATS,
  formatNumber,
  parseImageQuery,
  type ImageParams,
  type OutputFormat,
} from './contract.js'
import { admitsCrop, createContentRevisions, revisionOf, type SourcePolicy, type SourceRef } from './policy.js'
import { DEFAULT_AVIF_EFFORT, DEFAULT_MAX_INPUT_PIXELS, DEFAULT_TIMEOUT, createRenderQueue, mapSharpError, render, type Encoded } from './render.js'
import { RENDER_TYPES, openSource, parseSourcePath, realRoot, type Source, type SourcePath } from './source.js'
import { REVISION_PATTERN, TENANT_PATTERN, verifyCropToken, type CropTokenKeys } from './token.js'

export type OriginalType = 'gif' | 'svg'

export interface ImageServerOptions {
  /** Directory the source images are read from. */
  root: string
  /** Width ladder. Must match the loader's. */
  widths?: readonly number[]
  /** Ratio ladder. Must match the loader's. */
  ratios?: readonly number[]
  /** Allowed `q` values. Must match the loader's. Every request names one. */
  qualities?: readonly number[]
  /** Formats encoded. Must match the loader's `formats`. Default avif, webp and jpeg. */
  formats?: readonly OutputFormat[]
  /**
   * The deployment's namespace: part of every variant identity and of every
   * crop token. `[A-Za-z0-9._~-]{1,64}`, never taken from the request. Default `default`.
   */
  tenant?: string
  /**
   * The policy of a source, by its canonical path. `undefined` makes the
   * source a 404. Default: every source is public, with its content revision
   * and the default crops (see `SourcePolicy`).
   */
  policy?: (source: SourceRef) => SourcePolicy | undefined | Promise<SourcePolicy | undefined>
  /**
   * Crop token keys of this tenant by key id. With keys, a request carrying a
   * valid `token` may use any crop the token covers; an invalid token is a
   * 403. Without keys, or with an empty map, a `token` parameter is a 400.
   */
  keys?: CropTokenKeys
  /**
   * Viewer authorization for private sources, called before any cache hit or
   * 304. Without it, private sources are always a 403.
   */
  authorize?: (request: Request, source: SourceRef) => boolean | Promise<boolean>
  /**
   * Types served unchanged from a request without a query or with `v` alone,
   * e.g. `/_img/logo.svg?v=r2`: SVG with a sandboxing CSP, GIF with its
   * animation. A GIF with a transform query still renders its first frame.
   * Default both; `[]` turns pass-through off.
   */
  originals?: readonly OriginalType[]
  /** Sources larger than this many bytes are a 413, checked before decoding. Default 32 MB. */
  maxFileSize?: number
  /** Sources with more pixels than this are a 413. Default 50 MP. */
  maxInputPixels?: number
  /**
   * Response deadline in ms, from admission: waiting in the queue counts. The
   * request is answered with a 504 after this long. Each render also gives
   * sharp the full timeout when it starts, in whole seconds rounded up, to
   * stop decode and resize work; an AVIF encode already running finishes in
   * the background, still holding its render slot, so `avifEffort` bounds
   * that part. Default 10 s.
   */
  timeout?: number
  /**
   * Renders running at once. Default: half the CPUs, at least 1, since libvips
   * runs several threads per render. Each render holds the source file (up to
   * `maxFileSize`) and its decoded raster (up to `maxInputPixels` × 4 bytes).
   * Hashing a cold source for its default revision reads the file in a queue
   * of its own with the same concurrency, and the render reads it once more,
   * so peak file memory is up to 2 × `concurrency` × `maxFileSize`.
   */
  concurrency?: number
  /**
   * Renders waiting for a slot. Beyond it a new render is a 503 with
   * `Retry-After`. Hashing a source for its content revision has a queue of
   * the same size of its own. Default 4 × `concurrency`.
   */
  maxPending?: number
  /** Number of encoded images kept in memory. 0 disables the cache. Default 200. */
  cacheSize?: number
  /** Total bytes of encoded images kept in memory. 0 disables the cache. Default 64 MB. */
  cacheBytes?: number
  /** AVIF encoder effort, 0 (fastest) to 9 (smallest). Default 4. */
  avifEffort?: number
}

/** Bumped when the renderer's output for the same request changes. Part of every variant identity. */
export const TRANSFORM_PROFILE = '1'

const YEAR = 'max-age=31536000, immutable'
const ORIGINAL_EXTENSIONS: Record<OriginalType, string> = { gif: '.gif', svg: '.svg' }
const ORIGINAL_HEADERS: Record<OriginalType, Record<string, string>> = {
  gif: { 'Content-Type': 'image/gif' },
  svg: {
    'Content-Type': 'image/svg+xml',
    // Opened as a document, an SVG could run script; this keeps it inert.
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  },
}

const forbidden = (message: string) => new HTTPException(403, { message })
const unknownRevision = () => new HTTPException(404, { message: 'Unknown revision' })
const tooLarge = () => new HTTPException(413, { message: 'Source file is too large' })
/**
 * The bytes read for a render no longer match the revision the request was
 * admitted with. Thrown inside a shared job, so it carries no response:
 * `onError` builds a fresh one for each caller.
 */
class SourceChanged extends Error {
  constructor() {
    super('Source changed')
  }
}
/** Files whose earlier revisions are remembered, and how many each. */
const HISTORY_FILES = 1024
const EARLIER_REVISIONS = 4
/** Within this many ms of a rehash, a mismatching `v` reuses its result instead of reading the file again. */
const REHASH_COOLDOWN = 1000

/**
 * Hono app with one route, `GET /{src path}?ar&fmt&fx&fy&q&token&v&w` (spec
 * 6.1). Mount it at the loader's `baseUrl`, e.g. `app.route('/_img', createImageApp(…))`.
 * `HEAD` is answered by the same route.
 *
 * Admission order: canonical query and path (400), policy (404), viewer
 * authorization of private sources (403), file and size (404, 413), revision
 * (404), crop by token or policy (403), then a conditional request (304), the
 * in-memory cache, and the render queue (503, 504). A `HEAD` for a variant
 * that is not cached renders it like a `GET`.
 */
export function createImageApp({
  root,
  widths = DEFAULT_WIDTHS,
  ratios = DEFAULT_RATIOS,
  qualities = DEFAULT_QUALITIES,
  formats = OUTPUT_FORMATS,
  tenant = 'default',
  policy = () => ({}),
  keys,
  authorize,
  originals = ['gif', 'svg'],
  maxFileSize = 32 * 1024 * 1024,
  maxInputPixels = DEFAULT_MAX_INPUT_PIXELS,
  timeout = DEFAULT_TIMEOUT,
  concurrency = Math.max(1, Math.floor(availableParallelism() / 2)),
  maxPending = 4 * concurrency,
  cacheSize = 200,
  cacheBytes = 64 * 1024 * 1024,
  avifEffort = DEFAULT_AVIF_EFFORT,
}: ImageServerOptions): Hono {
  if (qualities.length === 0) throw new RangeError('qualities must not be empty')
  if (formats.length === 0 || formats.some((f) => !OUTPUT_FORMATS.includes(f))) throw new RangeError('formats must be avif, webp or jpeg')
  if (!TENANT_PATTERN.test(tenant)) throw new RangeError('tenant must be 1 to 64 URL-safe characters')
  // An empty map is no keys: a token is a 400, not a 403 for every token.
  const tokenKeys = keys && Object.keys(keys).length > 0 ? keys : undefined
  if (tokenKeys) {
    for (const [kid, key] of Object.entries(tokenKeys)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new RangeError(`Invalid key id ${kid}`)
      if (!(key instanceof Uint8Array) || key.byteLength < 16) throw new RangeError(`Key ${kid} needs at least 16 bytes`)
    }
  }
  const originalTypes = new Map(originals.map((type) => [ORIGINAL_EXTENSIONS[type], type] as const))
  const pathTypes = new Set([...RENDER_TYPES, ...originalTypes.keys()])

  const app = new Hono()
  const cache = new Map<string, Encoded>()
  let cachedBytes = 0
  const queue = createRenderQueue({ concurrency, maxPending, retryAfter: timeout / 1000 })
  const ladders = { widths, ratios, qualities, formats }
  const rootDir = realRoot(root)
  const revisions = createContentRevisions()
  // Cold content revisions read the whole file, so they are bounded like renders.
  const hashing = createRenderQueue({ concurrency, maxPending, retryAfter: timeout / 1000 })

  const readSource = async (source: Source) => {
    const bytes = await readFile(source.file)
    if (bytes.byteLength > maxFileSize) throw tooLarge()
    return bytes
  }
  const statKey = (source: Source) => [source.file, source.size, source.mtimeMs].join('\0')
  /** Hashes the file in the bounded queue, one job per stat at a time. */
  const hash = (source: Source, deadline: number): Promise<string> =>
    hashing.run(
      statKey(source),
      async () => {
        const bytes = await readSource(source)
        const revision = revisionOf(bytes)
        // Bytes of another size are not those of this stat; the render job will tell.
        if (bytes.byteLength === source.size) revisions.set(source, revision)
        supersede(source.file, revision)
        return revision
      },
      deadline,
    )
  /** The memoized content revision (`fresh: false`), or one hashed in the bounded queue. */
  const contentRevision = async (source: Source, deadline: number): Promise<{ revision: string; fresh: boolean }> => {
    const known = revisions.get(source)
    return known === undefined ? { revision: await hash(source, deadline), fresh: true } : { revision: known, fresh: false }
  }
  // Per real path, the last hashed revision and the revisions it replaced, so
  // a `v` of an earlier deploy is a 404 without reading the file again.
  // Bounded: the most recently hashed files, a few revisions each.
  const history = new Map<string, { current: string; earlier: string[] }>()
  const supersede = (file: string, revision: string) => {
    const entry = history.get(file) ?? { current: revision, earlier: [] }
    history.delete(file)
    if (entry.current !== revision) entry.earlier = [entry.current, ...entry.earlier.filter((r) => r !== revision)].slice(0, EARLIER_REVISIONS)
    entry.current = revision
    history.set(file, entry)
    while (history.size > HISTORY_FILES) history.delete(history.keys().next().value!)
  }
  const replaced = (file: string, version: string) => history.get(file)?.earlier.includes(version) ?? false
  // When each stat was last rehashed, oldest first; entries expire after the cooldown.
  const rehashed = new Map<string, number>()
  /**
   * A `v` that misses a memoized revision may name bytes rewritten in place
   * with the same size and mtime. Hash once more, at most once per stat and
   * cooldown (concurrent misses join one job), so a spray of random `v`
   * values costs at most one bounded read per source and second.
   */
  const rehash = async (source: Source, memo: string, deadline: number): Promise<string> => {
    const now = Date.now()
    for (const [key, at] of rehashed) {
      if (now - at < REHASH_COOLDOWN) break
      rehashed.delete(key)
    }
    const key = statKey(source)
    if (rehashed.has(key)) return revisions.get(source) ?? memo
    const revision = await hash(source, deadline)
    rehashed.delete(key)
    rehashed.set(key, Date.now())
    return revision
  }

  const forget = (key: string) => {
    const value = cache.get(key)
    if (!value) return
    cache.delete(key)
    cachedBytes -= value.body.byteLength
  }
  // Bounded by count and by bytes. A Map iterates oldest first.
  const remember = (key: string, value: Encoded) => {
    if (cacheSize <= 0 || value.body.byteLength > cacheBytes) return
    forget(key)
    cache.set(key, value)
    cachedBytes += value.body.byteLength
    while (cache.size > cacheSize || cachedBytes > cacheBytes) forget(cache.keys().next().value!)
  }
  const recall = (key: string) => {
    const value = cache.get(key)
    if (value) remember(key, value)
    return value
  }

  // Errors are never cached, and a 500 does not reveal internal paths.
  app.onError((error, c) => {
    if (error instanceof SourceChanged) {
      return c.text('Source changed', 503, { 'Retry-After': '1', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    }
    const mapped = mapSharpError(error)
    if (mapped instanceof HTTPException) {
      const response = mapped.getResponse()
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, headers })
    }
    console.error(error)
    return c.text('Internal Server Error', 500, { 'Cache-Control': 'no-store' })
  })

  app.get('/:path{.+}', async (c) => {
    const deadline = Date.now() + timeout
    const url = new URL(c.req.url)
    const query = url.search.slice(1)
    const sourcePath = parseSourcePath(rawSourcePath(c, url.pathname), pathTypes)
    // An original is requested without a query, or with `v` alone.
    const originalQuery = /^(?:v=([A-Za-z0-9._~-]{1,64}))?$/.exec(query)
    const original = originalQuery ? originalTypes.get(sourcePath.extension) : undefined
    // Validate the raw string: Hono's parsed query would hide order, duplicates and encoding.
    // An empty query is a 400 here unless the type is served as an original.
    const params = original ? undefined : parseImageQuery(query, ladders)
    if (params && !RENDER_TYPES.has(sourcePath.extension)) throw new HTTPException(400, { message: 'Unsupported file type' })
    if (params?.token !== undefined && !tokenKeys) throw new HTTPException(400, { message: 'Crop tokens are not enabled' })

    const ref: SourceRef = { tenant, path: sourcePath.canonical }
    const rules = await policy(ref)
    if (!rules) throw new HTTPException(404, { message: 'Image not found' })
    // Like invalid crops, a revision no `v` can name fails closed as a 500.
    if (rules.revision !== undefined && !(typeof rules.revision === 'string' && REVISION_PATTERN.test(rules.revision))) {
      throw new TypeError('A policy revision must be 1 to 64 URL-safe characters')
    }
    // Before the file system, the cache and 304s: a private image is checked on every request.
    if (rules.private && !(authorize && (await authorize(c.req.raw, ref)))) throw forbidden('Not authorized')

    const source = await openSource(await rootDir(), sourcePath, original ? new Set([ORIGINAL_EXTENSIONS[original]]) : RENDER_TYPES)
    if (source.size > maxFileSize) throw tooLarge()

    const version = params ? params.version : originalQuery?.[1]
    let revision: string
    if (rules.revision !== undefined) {
      revision = rules.revision
    } else {
      const content = await contentRevision(source, deadline)
      revision = content.revision
      // A `v` this file had before is simply stale; any other miss may name bytes rewritten in place.
      if (version !== undefined && version !== revision && !content.fresh && !replaced(source.file, version)) {
        revision = await rehash(source, revision, deadline)
      }
    }
    if (version !== undefined && version !== revision) throw unknownRevision()
    if (params) admit(params, rules, sourcePath)

    const identity = variantIdentity(source, sourcePath, revision, params)
    const etag = `"${createHash('sha256').update(identity).digest('base64url').slice(0, 32)}"`
    const headers: Record<string, string> = {
      // Only a validated revision in the URL makes a public response immutable.
      // A private one always revalidates, so `authorize` runs again and revoked access ends.
      'Cache-Control': rules.private ? 'private, no-cache' : version !== undefined ? `public, ${YEAR}` : 'public, no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      ...(original ? ORIGINAL_HEADERS[original] : {}),
    }

    if (matches(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers)

    let encoded = recall(identity)
    if (!encoded) {
      encoded = await queue.run(
        identity,
        async () => {
          // One read: the bytes that are hashed are the bytes that are rendered.
          const bytes = await readSource(source)
          if (rules.revision === undefined && revisionOf(bytes) !== revision) {
            // Rewritten since admission, or in place with the same size and mtime.
            revisions.delete(source)
            throw new SourceChanged()
          }
          // The full timeout: a request that joins later must not inherit an earlier deadline.
          const result = original
            ? checkOriginal(bytes, original, maxInputPixels)
            : await render(bytes, params!, { maxInputPixels, timeout, avifEffort }).catch((error: unknown) => {
                throw mapSharpError(error)
              })
          // Kept even when the response that asked for it has already timed out.
          remember(identity, result)
          return result
        },
        deadline,
      )
    }

    return c.body(encoded.body as Uint8Array<ArrayBuffer>, 200, {
      ...headers,
      'Content-Type': encoded.type,
      'Content-Length': String(encoded.body.byteLength),
    })
  })

  /** Throws a 403 unless a valid token or the policy admits the crop. */
  function admit(params: ImageParams, rules: SourcePolicy, sourcePath: SourcePath) {
    if (params.token !== undefined) {
      const grant = {
        tenant,
        source: sourcePath.canonical,
        revision: params.version,
        ar: params.aspectRatio === undefined ? undefined : formatNumber(params.aspectRatio),
        fx: params.focalPoint === undefined ? undefined : String(params.focalPoint.x),
        fy: params.focalPoint === undefined ? undefined : String(params.focalPoint.y),
      }
      if (!verifyCropToken(grant, params.token, tokenKeys!)) throw forbidden('Invalid crop token')
      return
    }
    if (!admitsCrop(rules, params, ratios)) throw forbidden('Crop not allowed for this source')
  }

  /**
   * Everything that selects the bytes: tenant, source, revision and the
   * file's identity, the transform profile and the representation. The token
   * and the spelling of the path are not part of it.
   */
  function variantIdentity(source: Source, sourcePath: SourcePath, revision: string, params: ImageParams | undefined): string {
    const common = [tenant, sourcePath.canonical, revision, source.size, source.mtimeMs]
    if (!params) return [...common, 'original'].join('\0')
    return [
      ...common,
      TRANSFORM_PROFILE,
      params.format,
      formatNumber(params.width),
      formatNumber(params.quality),
      params.aspectRatio === undefined ? '' : formatNumber(params.aspectRatio),
      params.focalPoint === undefined ? '' : `${params.focalPoint.x},${params.focalPoint.y}`,
      params.format === 'avif' ? avifEffort : '',
    ].join('\0')
  }

  return app
}

/**
 * The still-encoded source path after the mount point. Hono's `param()`
 * decodes it, which would turn `%2F` into a separator.
 */
function rawSourcePath(c: Context, pathname: string): string {
  const mount = c.req.routePath.replace(/\/:path\{\.\+\}$/, '')
  const depth = mount.split('/').filter(Boolean).length
  return pathname.split('/').slice(1 + depth).join('/')
}

/** The unchanged bytes of a GIF or SVG, after checking they are one. */
function checkOriginal(body: Buffer, type: OriginalType, maxInputPixels: number): Encoded {
  if (type === 'gif') {
    const header = body.subarray(0, 6).toString('latin1')
    if ((header !== 'GIF87a' && header !== 'GIF89a') || body.length < 10) throw new HTTPException(400, { message: 'Not a GIF' })
    if (body.readUInt16LE(6) * body.readUInt16LE(8) > maxInputPixels) throw new HTTPException(413, { message: 'Source has too many pixels' })
    return { body, type: 'image/gif' }
  }
  const text = body.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart()
  if (!text.startsWith('<') || !/<svg[\s>/]/i.test(text)) throw new HTTPException(400, { message: 'Not an SVG' })
  return { body, type: 'image/svg+xml' }
}

/** `If-None-Match` uses the weak comparison, so `W/"x"` matches `"x"`. */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').some((tag) => {
    const trimmed = tag.trim()
    return trimmed === '*' || trimmed.replace(/^W\//, '') === etag
  })
}
