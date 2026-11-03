import type { ImageFormat } from './loader.js'

// 1×1 white pixels, encoded with sharp.
const AVIF =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAobWRhdBIACggYAAbICGg0IDISHseHhVnAACwAACCQNZO/nkyA'
const WEBP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAB0CWJaQAA3AA/u9gAAA='

/** How long an image waits for detection before it falls back to WebP (spec 6.4). */
export const DETECTION_TIMEOUT = 200

let detection: Promise<ImageFormat> | undefined
let resolved: ImageFormat | undefined

function decodes(uri: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new globalThis.Image()
    // onload/onerror rather than decode(), which WebKit does not always settle.
    img.onload = () => resolve(img.width > 0)
    img.onerror = () => resolve(false)
    img.src = uri
  })
}

async function detect(): Promise<ImageFormat> {
  if (await decodes(AVIF)) return 'avif'
  if (await decodes(WEBP)) return 'webp'
  return 'jpeg'
}

/**
 * Starts the AVIF/WebP decode test, once per page. The provider calls it on
 * mount so the result is usually there before the first image intersects.
 * Outside a browser it resolves to WebP without touching the DOM.
 */
export function startFormatDetection(): Promise<ImageFormat> {
  if (!detection) {
    const pending: Promise<ImageFormat> =
      typeof document === 'undefined' || typeof globalThis.Image === 'undefined'
        ? Promise.resolve('webp')
        : detect()
    detection = pending
    void pending.then((format) => {
      // A reset while detection ran makes this result stale.
      if (detection === pending) resolved = format
    })
  }
  return detection
}

/** The detection result once it is known, so images can skip the wait. */
export function resolvedFormat(): ImageFormat | undefined {
  return resolved
}

/**
 * The best format this browser decodes. Starts detection if needed and
 * resolves to WebP when it takes longer than 200 ms.
 */
export function detectFormat(): Promise<ImageFormat> {
  const result = startFormatDetection()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ImageFormat>((resolve) => {
    timer = setTimeout(() => resolve('webp'), DETECTION_TIMEOUT)
  })
  return Promise.race([result, timeout]).finally(() => clearTimeout(timer))
}

/** Forgets the detection result. For tests. */
export function resetFormatDetection(): void {
  detection = undefined
  resolved = undefined
}
