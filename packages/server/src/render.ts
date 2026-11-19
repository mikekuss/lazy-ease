import { readFile } from 'node:fs/promises'
import { cropWindow } from '@lazy-ease/core'
import { HTTPException } from 'hono/http-exception'
import sharp, { type Metadata, type SharpOptions } from 'sharp'
import type { ImageParams } from './contract.js'

export const DEFAULT_MAX_INPUT_PIXELS = 50_000_000
export const DEFAULT_TIMEOUT = 10_000
export const DEFAULT_AVIF_EFFORT = 4

export interface Encoded {
  body: Uint8Array
  type: string
}

/** Width and height after EXIF rotation. */
export function orientedSize(meta: Metadata): { width?: number; height?: number } {
  const swap = (meta.orientation ?? 1) >= 5
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
}

/** Decoder options shared by rendering and metadata. `animated: false` reads the first frame only. */
export function inputOptions(maxInputPixels: number): SharpOptions {
  return { limitInputPixels: maxInputPixels, failOn: 'warning', animated: false }
}

/** Turns sharp's limit errors into the statuses of spec 12.1. Others pass through as a 500. */
export function mapSharpError(error: unknown): unknown {
  if (error instanceof HTTPException) return error
  const message = error instanceof Error ? error.message : ''
  if (/pixel limit/i.test(message)) return new HTTPException(413, { message: 'Source has too many pixels' })
  if (/timeout/i.test(message)) return new HTTPException(504, { message: 'Render timed out' })
  return error
}

export interface RenderOptions {
  /** Sources with more pixels than this fail (a 413 through `mapSharpError`). Default 50 MP. */
  maxInputPixels?: number
  /**
   * In ms, rounded up to whole seconds for sharp's `timeout()` (a 504 through
   * `mapSharpError`), which stops decode and resize work but not an AVIF
   * encode that is already running. Bounding the response is up to the
   * caller (`withDeadline`). Default 10 s.
   */
  timeout?: number
  /** AVIF encoder effort, 0 (fastest) to 9 (smallest). Default 4. */
  avifEffort?: number
}

/**
 * Renders one variant (spec 12.1) from a file path or from the source's
 * bytes: auto-orient, crop to `w × round(w / ar)` around the focal point
 * (default: the center) when `ar` is given, never upscale, sRGB, no metadata.
 */
export async function render(
  input: string | Uint8Array,
  params: ImageParams,
  { maxInputPixels = DEFAULT_MAX_INPUT_PIXELS, timeout = DEFAULT_TIMEOUT, avifEffort = DEFAULT_AVIF_EFFORT }: RenderOptions = {},
): Promise<Encoded> {
  // Decode from memory: libvips caches and holds open files by name, which would
  // serve stale pixels after a source changes and, on Windows, lock it.
  const bytes = typeof input === 'string' ? await readFile(input) : input
  // limitInputPixels rejects an oversized source before its pixels are decoded.
  const image = sharp(bytes, inputOptions(maxInputPixels)).timeout({ seconds: Math.ceil(timeout / 1000) })
  const oriented = orientedSize(await image.metadata())

  const { width, aspectRatio, focalPoint, quality, format } = params
  // Auto-orient first, so the crop window is in the coordinates the focal point was picked in.
  image.rotate()
  let source = oriented
  if (aspectRatio && focalPoint && oriented.width && oriented.height) {
    const window = cropWindow(oriented.width, oriented.height, aspectRatio, focalPoint)
    image.extract(window)
    source = { width: window.width, height: window.height }
  }
  const height = aspectRatio ? Math.round(width / aspectRatio) : undefined
  // Never upscale. Shrink the target box instead so the aspect ratio survives.
  const scale = Math.min(
    1,
    (source.width ?? width) / width,
    height ? (source.height ?? height) / height : 1,
  )
  image
    .resize({
      width: Math.max(1, Math.round(width * scale)),
      height: height ? Math.max(1, Math.round(height * scale)) : undefined,
      fit: height ? 'cover' : 'inside',
      position: 'centre',
    })
    // sharp drops EXIF, XMP, IPTC and the ICC profile unless asked to keep them.
    .toColourspace('srgb')

  switch (format) {
    case 'avif':
      image.avif({ quality, effort: avifEffort })
      break
    case 'webp':
      image.webp({ quality })
      break
    case 'jpeg':
      image.jpeg({ quality, mozjpeg: true })
      break
  }
  return { body: await image.toBuffer(), type: `image/${format}` }
}

/**
 * Calls `expire` once `Date.now()` has reached `deadline`, never earlier
 * (a timer can fire a millisecond early), and returns the cancel function.
 * The response and the queue decide by the same clock, so a job is never
 * started for a response that has already timed out.
 */
function atDeadline(deadline: number, expire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>
  const check = () => {
    const left = deadline - Date.now()
    if (left > 0) timer = setTimeout(check, left)
    else expire()
  }
  check()
  return () => clearTimeout(timer)
}

/**
 * Rejects with a 504 at `deadline` (a `Date.now()` time). This bounds the
 * response; the work behind `promise` keeps running until it settles.
 */
export async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let cancel = () => {}
  const expired = new Promise<never>((_, reject) => {
    cancel = atDeadline(deadline, () => reject(timedOut()))
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    cancel()
  }
}

const timedOut = () => new HTTPException(504, { message: 'Timed out' })

/** A 503 with `Retry-After`, for a full queue. */
export function overloaded(retryAfter: number): HTTPException {
  const res = new Response('Server busy', {
    status: 503,
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))), 'Cache-Control': 'no-store' },
  })
  return new HTTPException(503, { res, message: 'Server busy' })
}

export interface RenderQueueOptions {
  /** Jobs running at once. */
  concurrency: number
  /** Jobs waiting for a slot. A new job beyond this is a 503. */
  maxPending: number
  /** Seconds sent in `Retry-After` with that 503. Default 1. */
  retryAfter?: number
}

export interface RenderQueue {
  /**
   * Runs `task` once a slot is free and resolves with its result, or rejects
   * with a 504 at `deadline` (a `Date.now()` time) and a 503 when the queue is
   * full. While a job for `key` is queued or running, further calls join it.
   *
   * A slot and the key stay taken until `task` settles, even after every
   * caller has timed out: the native work behind it still runs. A queued job
   * whose callers have all timed out is dropped without starting.
   */
  run<T>(key: string, task: () => Promise<T>, deadline: number): Promise<T>
  /** Jobs running right now, including those whose callers have gone. */
  readonly active: number
  /** Jobs waiting for a slot. */
  readonly pending: number
}

interface Job {
  key: string
  task: () => Promise<unknown>
  promise: Promise<unknown>
  resolve(value: unknown): void
  reject(error: unknown): void
  started: boolean
  waiters: number
  /** The latest deadline of its callers; a queued job is not started after it. */
  deadline: number
}

export function createRenderQueue({ concurrency, maxPending, retryAfter = 1 }: RenderQueueOptions): RenderQueue {
  if (!(concurrency >= 1)) throw new RangeError('concurrency must be at least 1')
  if (!(maxPending >= 0)) throw new RangeError('maxPending must be at least 0')
  const jobs = new Map<string, Job>()
  const waiting: Job[] = []
  let active = 0

  const start = (job: Job) => {
    job.started = true
    active++
    let work: Promise<unknown>
    try {
      work = Promise.resolve(job.task())
    } catch (error) {
      work = Promise.reject(error)
    }
    work.then(job.resolve, job.reject).finally(() => {
      active--
      if (jobs.get(job.key) === job) jobs.delete(job.key)
      while (active < concurrency && waiting.length > 0) {
        const next = waiting.shift()!
        if (Date.now() < next.deadline) start(next)
        else {
          // Every caller is past its deadline, even if its timer has not run yet.
          jobs.delete(next.key)
          next.reject(timedOut())
        }
      }
    })
  }

  const wait = <T>(job: Job, deadline: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      job.waiters++
      job.deadline = Math.max(job.deadline, deadline)
      const cancel = atDeadline(deadline, () => {
        job.waiters--
        if (!job.started && job.waiters === 0 && waiting.includes(job)) {
          // Nobody waits for it any more: drop it before it starts.
          waiting.splice(waiting.indexOf(job), 1)
          jobs.delete(job.key)
          job.reject(timedOut())
        }
        reject(timedOut())
      })
      job.promise.then(
        (value) => {
          cancel()
          job.waiters--
          resolve(value as T)
        },
        (error: unknown) => {
          cancel()
          job.waiters--
          reject(error)
        },
      )
    })

  return {
    run<T>(key: string, task: () => Promise<T>, deadline: number): Promise<T> {
      if (Date.now() >= deadline) return Promise.reject(timedOut())
      let job = jobs.get(key)
      if (!job) {
        if (active >= concurrency && waiting.length >= maxPending) return Promise.reject(overloaded(retryAfter))
        let resolve!: (value: unknown) => void
        let reject!: (error: unknown) => void
        const promise = new Promise<unknown>((res, rej) => {
          resolve = res
          reject = rej
        })
        // A job can settle with nobody waiting.
        promise.catch(() => {})
        job = { key, task, promise, resolve, reject, started: false, waiters: 0, deadline }
        jobs.set(key, job)
        if (active < concurrency) start(job)
        else waiting.push(job)
      }
      return wait<T>(job, deadline)
    },
    get active() {
      return active
    },
    get pending() {
      return waiting.length
    },
  }
}
