import type { ImageFormat } from '../loader.js'

// 1×1 white pixels, encoded with sharp.
const AVIF =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAobWRhdBIACggYAAbICGg0IDISHseHhVnAACwAACCQNZO/nkyA'

/** How long an image waits for detection before it falls back to WebP. */
export const DETECTION_TIMEOUT = 200

const PREFERENCE: readonly ImageFormat[] = ['avif', 'webp', 'jpeg']
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

/** The best format both the browser (`best` and anything older) and the loader support. */
export function pickFormat(best: ImageFormat, formats: readonly ImageFormat[]): ImageFormat {
  return PREFERENCE.slice(PREFERENCE.indexOf(best)).find((format) => formats.includes(format)) ?? formats[0] ?? best
}

/**
 * The format to request from a loader that declares `formats`. `'auto'` and
 * a single format need no probe. Otherwise the AVIF decode test runs
 * once per page, on first need, and an image waits for it at most 200 ms
 * before taking WebP.
 */
export function chooseFormat(formats: readonly ImageFormat[] | 'auto'): ImageFormat | 'auto' | Promise<ImageFormat> {
  if (formats === 'auto') return formats
  if (formats.length < 2) return formats[0] ?? 'webp'
  if (detected) return pickFormat(detected, formats)
  detection ??= decodesAvif().then((best) => (detected = best))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ImageFormat>((resolve) => {
    timer = setTimeout(resolve, DETECTION_TIMEOUT, 'webp')
  })
  return Promise.race([detection, timeout]).then((best) => {
    clearTimeout(timer)
    return pickFormat(best, formats)
  })
}

/** Forgets the detection result. For tests. */
export function resetFormatDetection(): void {
  detection = detected = undefined
}
