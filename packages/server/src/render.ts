import { readFile } from 'node:fs/promises'
import { HTTPException } from 'hono/http-exception'
import sharp, { type Metadata, type SharpOptions } from 'sharp'
import type { ImageParams } from './contract.js'

export const DEFAULT_MAX_INPUT_PIXELS = 50_000_000

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
  maxInputPixels: number
  /** In ms. Passed to sharp as well, rounded up to whole seconds, so abandoned work stops. */
  timeout: number
}

/**
 * Renders one variant (spec 12.1): auto-orient, crop to `w × round(w / ar)`
 * around the center when `ar` is given, never upscale, sRGB, no metadata.
 */
export async function render(file: string, params: ImageParams, { maxInputPixels, timeout }: RenderOptions): Promise<Encoded> {
  // Decode from memory: libvips caches and holds open files by name, which would
  // serve stale pixels after a source changes and, on Windows, lock it.
  const input = await readFile(file)
  const image = sharp(input, inputOptions(maxInputPixels)).timeout({ seconds: Math.ceil(timeout / 1000) })
  const source = orientedSize(await image.metadata())
  if ((source.width ?? 0) * (source.height ?? 0) > maxInputPixels) {
    throw new HTTPException(413, { message: 'Source has too many pixels' })
  }

  const { width, aspectRatio, quality, format } = params
  const height = aspectRatio ? Math.round(width / aspectRatio) : undefined
  // Never upscale. Shrink the target box instead so the aspect ratio survives.
  const scale = Math.min(
    1,
    (source.width ?? width) / width,
    height ? (source.height ?? height) / height : 1,
  )
  image
    .rotate()
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
      image.avif({ quality, effort: 4 })
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

/** Rejects with a 504 when `promise` takes longer than `ms`. */
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
