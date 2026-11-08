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
   * caller (`withTimeout`). Default 10 s.
   */
  timeout?: number
  /** AVIF encoder effort, 0 (fastest) to 9 (smallest). Default 4. */
  avifEffort?: number
}

/**
 * Renders one variant (spec 12.1): auto-orient, crop to `w × round(w / ar)`
 * around the focal point (default: the center) when `ar` is given, never
 * upscale, sRGB, no metadata.
 */
export async function render(
  file: string,
  params: ImageParams,
  { maxInputPixels = DEFAULT_MAX_INPUT_PIXELS, timeout = DEFAULT_TIMEOUT, avifEffort = DEFAULT_AVIF_EFFORT }: RenderOptions = {},
): Promise<Encoded> {
  // Decode from memory: libvips caches and holds open files by name, which would
  // serve stale pixels after a source changes and, on Windows, lock it.
  const input = await readFile(file)
  // limitInputPixels rejects an oversized source before its pixels are decoded.
  const image = sharp(input, inputOptions(maxInputPixels)).timeout({ seconds: Math.ceil(timeout / 1000) })
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
 * Rejects with a 504 when `promise` takes longer than `ms`. This bounds the
 * response; the work behind `promise` keeps running until it settles.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HTTPException(504, { message: 'Render timed out' })), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export interface RenderQueue {
  /**
   * Runs `task` once a slot is free. While a task for `key` is queued or
   * running, further calls with that key get the same promise.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T>
  /** Tasks running right now. */
  readonly active: number
}

export function createRenderQueue(concurrency: number): RenderQueue {
  if (!(concurrency >= 1)) throw new RangeError('concurrency must be at least 1')
  const inFlight = new Map<string, Promise<unknown>>()
  const waiting: (() => void)[] = []
  let active = 0

  const acquire = async () => {
    if (active < concurrency) {
      active++
      return
    }
    // release() hands its slot over directly, so `active` stays the same.
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const pending = inFlight.get(key)
      if (pending) return pending as Promise<T>
      const promise = (async () => {
        await acquire()
        try {
          return await task()
        } finally {
          release()
        }
      })()
      inFlight.set(key, promise)
      const forget = () => {
        inFlight.delete(key)
      }
      promise.then(forget, forget)
      return promise
    },
    get active() {
      return active
    },
  }
}
