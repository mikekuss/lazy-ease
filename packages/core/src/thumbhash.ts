import { formatNumber } from './numbers.js'
import { cssUrl, type Placeholder, type StyleRecord, type ThumbHashDecoder } from './styles.js'

// Core compiles without DOM or Node types. Browsers, workers and Node 16+ all have it.
declare function atob(data: string): string

/** The two functions of the `thumbhash` package (MIT, Evan Wallace) this entry uses. */
export interface ThumbHashFunctions {
  thumbHashToDataURL(hash: ArrayLike<number>): string
  thumbHashToAverageRGBA(hash: ArrayLike<number>): { r: number; g: number; b: number; a: number }
}

const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/
// The data URI is up to ~6 KB each (the PNG in its blurring SVG), so keep only the recent ones.
const MAX_CACHED = 256

function decode(hash: string): Uint8Array | undefined {
  if (!BASE64.test(hash)) return undefined
  let binary: string
  try {
    binary = atob(hash.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return undefined
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  // 5 header bytes, one more when the alpha flag (bit 23) is set.
  if (bytes.length < 5 || (hasAlpha(bytes) && bytes.length < 6)) return undefined
  return bytes
}

/** Options of `thumbhashDecoder()`. */
export interface ThumbHashDecoderOptions {
  /**
   * Blur of the decoded image, as a Gaussian standard deviation in percent of
   * its longer edge. The browser upscales the small decoded PNG with visible
   * steps; an SVG filter draws it smooth instead. `0` paints the PNG as is.
   * Default 8.
   */
  blur?: number
}

/** Width and height from the IHDR chunk of a base64 PNG data URI. */
function pngSize(url: string): [number, number] | undefined {
  const comma = url.indexOf(',')
  if (!/^data:image\/png;base64,/i.test(url.slice(0, comma + 1))) return undefined
  let head: string
  try {
    head = atob(url.slice(comma + 1, comma + 33))
  } catch {
    return undefined
  }
  if (head.length < 24 || head.slice(12, 16) !== 'IHDR') return undefined
  const read = (at: number) => [0, 1, 2, 3].reduce((n, i) => n * 256 + head.charCodeAt(at + i), 0)
  const size: [number, number] = [read(16), read(20)]
  return size[0] && size[1] ? size : undefined
}

/**
 * The PNG inside an SVG that blurs it. For an opaque image the filter puts
 * the alpha back to 1 afterwards, so the edges, which the blur mixes with the
 * transparent outside, stay opaque; the colors keep their average there. An
 * image with alpha keeps the blurred alpha, so its transparent parts stay
 * transparent.
 */
function blurred(png: string, blur: number, alpha: boolean): string {
  const size = blur > 0 && pngSize(png)
  if (!size) return png
  const [w, h] = size
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>` +
    `<filter id='b' color-interpolation-filters='sRGB'><feGaussianBlur stdDeviation='${formatNumber((blur / 100) * Math.max(w, h))}'/>` +
    (alpha ? '' : `<feComponentTransfer><feFuncA type='discrete' tableValues='1 1'/></feComponentTransfer>`) +
    `</filter>` +
    `<image width='${w}' height='${h}' preserveAspectRatio='none' filter='url(%23b)' href='${png}'/></svg>`
  return `data:image/svg+xml,${svg}`
}

// The alpha flag, bit 23 of the header.
const hasAlpha = (bytes: Uint8Array) => bytes[2]! >> 7 === 1

const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)

/**
 * A decoder for `thumbhash:` placeholders, built from the `thumbhash`
 * package, which the application installs and passes in:
 *
 * ```js
 * import * as thumbhash from 'thumbhash'
 * import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
 * const le = createLazyEase({ thumbhash: thumbhashDecoder(thumbhash) })
 * ```
 *
 * The average color is shown at once; the decoded image is built when the
 * image is about to load, and memoized for the most recent hashes. It is
 * drawn blurred, see `blur`.
 */
export function thumbhashDecoder(functions: ThumbHashFunctions, options: ThumbHashDecoderOptions = {}): ThumbHashDecoder {
  // Only an absent blur takes the default; isFinite first, so no value throws a TypeError of its own.
  const { blur = 8 } = options
  if (!Number.isFinite(blur) || blur < 0) throw new RangeError('[lazy-ease] thumbhash blur must be a finite number from 0')
  const images = new Map<string, StyleRecord>()
  return (hash) => {
    const bytes = decode(hash)
    if (!bytes) return undefined
    const { r, g, b, a } = functions.thumbHashToAverageRGBA(bytes)
    const rgb = [r, g, b].map(channel)
    const backgroundColor =
      a >= 1 ? `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}` : `rgba(${rgb.join(', ')}, ${formatNumber(a)})`
    const alpha = hasAlpha(bytes)
    const placeholder: Placeholder = {
      style: { backgroundColor },
      transparent: alpha,
      lazy: () => {
        let style = images.get(hash)
        if (!style) {
          const image = { backgroundImage: cssUrl(blurred(functions.thumbHashToDataURL(bytes), blur, alpha)), backgroundSize: 'cover' }
          // Under a transparent image the average color would tint the whole box.
          style = alpha ? image : { backgroundColor, ...image }
          if (images.size >= MAX_CACHED) images.delete(images.keys().next().value!)
          images.set(hash, style)
        }
        return style
      },
    }
    return placeholder
  }
}
