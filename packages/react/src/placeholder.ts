import { thumbHashToApproximateAspectRatio, thumbHashToAverageRGBA, thumbHashToDataURL } from 'thumbhash'
import { formatNumber } from '@lazy-ease/core'

/** Inline style for the box. Assignable to React's `CSSProperties`. */
export interface PlaceholderStyle {
  backgroundColor?: string
  backgroundImage?: string
  backgroundSize?: string
  backgroundPosition?: string
}

export type Placeholder =
  | { kind: 'none'; ssrStyle: PlaceholderStyle }
  | { kind: 'color'; ssrStyle: PlaceholderStyle }
  | { kind: 'data'; ssrStyle: PlaceholderStyle }
  | {
      kind: 'thumbhash'
      /** Only the average color: no decode, a few bytes of HTML. */
      ssrStyle: PlaceholderStyle
      /** The decoded image, for after hydration. Memoized per hash. */
      clientStyle: () => PlaceholderStyle
      /** The source's approximate width / height, stored in the hash. */
      ratio: number
    }
  /** Not a usable placeholder. Renders nothing; the component warns in development. */
  | { kind: 'invalid'; ssrStyle: PlaceholderStyle; reason: string }

const THUMBHASH_PREFIX = 'thumbhash:'
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/
// Nothing a CSS color needs, everything that could end the declaration early.
const UNSAFE_COLOR = /[;{}<>"'\\\n\r]|url\(/i

function invalid(reason: string): Placeholder {
  return { kind: 'invalid', ssrStyle: {}, reason }
}

// `"`, `\` and line breaks would end the CSS string. Percent-encoding them
// is valid in a data URI and keeps its meaning.
function cssUrl(uri: string): string {
  return `url("${uri.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`
}

function decodeThumbHash(hash: string): Uint8Array | undefined {
  if (!BASE64.test(hash)) return undefined
  let binary: string
  try {
    binary = atob(hash.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return undefined
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  // 5 header bytes, one more when the alpha flag (bit 23) is set.
  if (bytes.length < 5) return undefined
  if (bytes[2]! >> 7 && bytes.length < 6) return undefined
  return bytes
}

const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)

function averageColor(bytes: Uint8Array): string {
  const { r, g, b, a } = thumbHashToAverageRGBA(bytes)
  const rgb = [r, g, b].map(channel)
  if (a >= 1) return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  return `rgba(${rgb.join(', ')}, ${formatNumber(a)})`
}

// The data URI is up to ~5.5 KB each, so keep only the recent ones.
const MAX_CACHED = 256
const imageStyles = new Map<string, PlaceholderStyle>()

function imageStyle(hash: string, bytes: Uint8Array): PlaceholderStyle {
  let style = imageStyles.get(hash)
  if (style) return style
  style = {
    backgroundColor: averageColor(bytes),
    backgroundImage: cssUrl(thumbHashToDataURL(bytes)),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
  if (imageStyles.size >= MAX_CACHED) imageStyles.delete(imageStyles.keys().next().value!)
  imageStyles.set(hash, style)
  return style
}

/**
 * The decoded ThumbHash as a box style, for the opt-in server path
 * (`thumbhashSsr: 'image'` or `priority`). `hash` is the base64 hash without
 * the `thumbhash:` prefix. Throws on a malformed hash.
 */
export function thumbhashImageStyle(hash: string): PlaceholderStyle {
  const bytes = decodeThumbHash(hash)
  if (!bytes) throw new TypeError(`Invalid ThumbHash: ${hash}`)
  return imageStyle(hash, bytes)
}

/**
 * Reads a `placeholder` prop (spec 8): `'none'`, a data URI, `thumbhash:` plus
 * base64, or otherwise a CSS color. Never touches the DOM, so it is safe
 * during render.
 */
export function parsePlaceholder(value: string): Placeholder {
  const input = value.trim()
  if (input === 'none') return { kind: 'none', ssrStyle: {} }

  const lower = input.slice(0, THUMBHASH_PREFIX.length).toLowerCase()
  if (lower.startsWith('data:')) {
    return {
      kind: 'data',
      ssrStyle: { backgroundImage: cssUrl(input), backgroundSize: 'cover', backgroundPosition: 'center' },
    }
  }

  if (lower === THUMBHASH_PREFIX) {
    const hash = input.slice(THUMBHASH_PREFIX.length)
    const bytes = decodeThumbHash(hash)
    if (!bytes) return invalid(`"${hash}" is not a valid base64 ThumbHash`)
    return {
      kind: 'thumbhash',
      ssrStyle: { backgroundColor: averageColor(bytes) },
      clientStyle: () => imageStyle(hash, bytes),
      ratio: thumbHashToApproximateAspectRatio(bytes),
    }
  }

  if (input === '') return invalid('The placeholder is empty')
  if (UNSAFE_COLOR.test(input)) return invalid(`"${input}" is not a CSS color`)
  return { kind: 'color', ssrStyle: { backgroundColor: input } }
}
