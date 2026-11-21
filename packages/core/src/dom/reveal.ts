/**
 * How a deferred image appears over its placeholder: the keyframes of its
 * reveal, run for the fade duration. `edge` is the box's longer edge in CSS
 * px as a ResizeObserver last reported it, 0 before any report, so a reveal
 * reads no layout. Without a reveal the image crossfades.
 */
export type Reveal = (edge: number) => Keyframe[]

/**
 * Brings the image in as blurred as a ThumbHash placeholder from
 * `thumbhashDecoder()` (8 % of the longer edge, 24 px without a size),
 * opaque at 45 % of the fade while the two blurs still match, and sharpens
 * it until the end, so the placeholder seems to come into focus. A separate
 * export, so bundles without it don't carry it.
 */
export const focusReveal: Reveal = (edge) => [
  { opacity: 0, filter: `blur(${edge ? Math.round(edge * 0.8) / 10 : 24}px)`, easing: 'ease-out' },
  { opacity: 1, offset: 0.45 },
  { opacity: 1, filter: 'blur(0px)' },
]
