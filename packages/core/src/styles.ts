import { coverPosition, cropWindow, focusInWindow, percentPosition, type FocalPoint } from './focal.js'

/**
 * Inline CSS declarations, keyed by camel-case property name as in
 * `CSSStyleDeclaration` and React's `style`. Values are complete CSS text:
 * every length carries its unit, so no adapter has to guess one.
 */
export type StyleRecord = Partial<Record<string, string>>

/** A decoded placeholder: what to show at once, and optionally a richer style to swap in on demand. */
export interface Placeholder {
  /** Cheap enough for the server HTML: a color or a data URI. */
  style: StyleRecord
  /** The decoded image, for once the image is about to load. */
  lazy?: () => StyleRecord
}

/** Decodes the base64 part of a `thumbhash:` placeholder. Undefined for a malformed hash. */
export type ThumbHashDecoder = (hash: string) => Placeholder | undefined

// `"`, `\` and line breaks would end the CSS string. Percent-encoding them
// is valid in a data URI and keeps its meaning.
export const cssUrl = (uri: string): string => `url("${uri.replace(/["\\\n\r]/g, encodeURIComponent)}")`

// Nothing a CSS color needs, everything that could end the declaration early.
const UNSAFE_COLOR = /[;{}<>"'\\\n\r]|url\(/i

/**
 * Reads a placeholder value: `'none'`, a data URI, `thumbhash:` plus base64
 * (only with a registered decoder, see `@lazy-ease/core/thumbhash`) or a CSS
 * color. Undefined when the value is unusable.
 */
export function parsePlaceholder(value: string, thumbhash?: ThumbHashDecoder): Placeholder | undefined {
  const input = value.trim()
  if (input === 'none') return { style: {} }
  if (/^data:/i.test(input)) return { style: { backgroundImage: cssUrl(input), backgroundSize: 'cover' } }
  if (/^thumbhash:/i.test(input)) return thumbhash?.(input.slice(10))
  return input && !UNSAFE_COLOR.test(input) ? { style: { backgroundColor: input } } : undefined
}

export interface FocusStyleOptions {
  /** Normalized focal point. */
  focus: FocalPoint
  /** The ratio the backend crops the delivered image to, if it crops. */
  crop?: number
  srcWidth?: number
  srcHeight?: number
}

export interface FocusStyles {
  /** For the box: a size container when the image position uses container units. */
  box: StyleRecord
  /** For the img, drawn with `object-fit: cover`. */
  img: StyleRecord
}

/**
 * The styles that put the focal point as close to the box center as the
 * delivered image allows. A server-cropped image already has the point near
 * its center, so only the rest of the crop is left, which needs the source
 * size to place exactly; without it the center is within about 1 % of the
 * box. An uncropped image needs the source ratio, or falls back to a
 * percentage.
 */
export function focusStyles({ focus, crop, srcWidth, srcHeight }: FocusStyleOptions): FocusStyles {
  let position: string | undefined
  if (!srcWidth || !srcHeight) position = crop === undefined ? percentPosition(focus) : undefined
  else if (crop === undefined) position = coverPosition(srcWidth / srcHeight, focus)
  else position = coverPosition(crop, focusInWindow(srcWidth, srcHeight, cropWindow(srcWidth, srcHeight, crop, focus), focus))
  return position === undefined
    ? { box: {}, img: {} }
    : { box: position.includes('cq') ? { containerType: 'size' } : {}, img: { objectPosition: position } }
}
