import { DEFAULT_FORMATS as PREFERENCE, type ImageFormat } from '../loader.js'

/**
 * Picks the format to request from a loader that declares several, e.g.
 * `detectAvif`. Called only for a list, never for `formats: 'auto'`.
 */
export type FormatDetector = (formats: readonly ImageFormat[]) => ImageFormat | Promise<ImageFormat>

// 1×1 white pixels, encoded with sharp.
const AVIF =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAobWRhdBIACggYAAbICGg0IDISHseHhVnAACwAACCQNZO/nkyA'

/** How long an image waits for detection before it falls back to the best declared format other than AVIF. */
export const DETECTION_TIMEOUT = 200

let detection: Promise<ImageFormat> | undefined
let detected: ImageFormat | undefined

// Every browser that runs this ES2022 code decodes WebP (Safari since 14),
// so only AVIF needs a probe.
const decodesAvif = (): Promise<ImageFormat> =>
  new Promise((resolve) => {
    const img = new Image()
    // onload/onerror rather than decode(), which WebKit does not always settle.
    img.onload = () => resolve(img.width > 0 ? 'avif' : 'webp')
    img.onerror = () => resolve('webp')
    img.src = AVIF
  })

/**
 * The best format both the browser (`best` and anything older) and the
 * loader support. With the default, what an instance without a detector requests.
 */
export function pickFormat(formats: readonly ImageFormat[], best: ImageFormat = 'webp'): ImageFormat {
  return PREFERENCE.slice(PREFERENCE.indexOf(best)).find((format) => formats.includes(format)) ?? formats[0] ?? best
}

/**
 * The `detectFormat` of a controller that requests AVIF where the browser
 * decodes it. A single format, or formats without AVIF, need no probe.
 * Otherwise the AVIF decode test runs once per page, on first need, and an
 * image waits for it at most 200 ms before taking the best declared format
 * other than AVIF: WebP if declared, otherwise JPEG.
 */
export const detectAvif: FormatDetector = (formats) => {
  // Only AVIF needs a probe, and only when the loader declares it besides another format.
  if (formats.length < 2 || !formats.includes('avif')) return pickFormat(formats)
  if (detected) return pickFormat(formats, detected)
  detection ??= decodesAvif().then((best) => (detected = best))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ImageFormat>((resolve) => {
    timer = setTimeout(resolve, DETECTION_TIMEOUT, 'webp')
  })
  return Promise.race([detection, timeout]).then((best) => {
    clearTimeout(timer)
    return pickFormat(formats, best)
  })
}

/** Forgets the detection result. For tests. */
export function resetFormatDetection(): void {
  detection = detected = undefined
}
