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
// The data URI is up to ~5.5 KB each, so keep only the recent ones.
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
  if (bytes.length < 5 || (bytes[2]! >> 7 && bytes.length < 6)) return undefined
  return bytes
}

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
 * image is about to load, and memoized for the most recent hashes.
 */
export function thumbhashDecoder(functions: ThumbHashFunctions): ThumbHashDecoder {
  const images = new Map<string, StyleRecord>()
  return (hash) => {
    const bytes = decode(hash)
    if (!bytes) return undefined
    const { r, g, b, a } = functions.thumbHashToAverageRGBA(bytes)
    const rgb = [r, g, b].map(channel)
    const backgroundColor =
      a >= 1 ? `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}` : `rgba(${rgb.join(', ')}, ${formatNumber(a)})`
    const placeholder: Placeholder = {
      style: { backgroundColor },
      lazy: () => {
        let style = images.get(hash)
        if (!style) {
          style = { backgroundColor, backgroundImage: cssUrl(functions.thumbHashToDataURL(bytes)), backgroundSize: 'cover' }
          if (images.size >= MAX_CACHED) images.delete(images.keys().next().value!)
          images.set(hash, style)
        }
        return style
      },
    }
    return placeholder
  }
}
