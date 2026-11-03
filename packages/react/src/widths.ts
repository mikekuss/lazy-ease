/**
 * Widths the backend renders (spec 3). A fixed list keeps the number of cached
 * variants per image small. Part of the loader; the backend must agree.
 */
export const DEFAULT_WIDTHS: readonly number[] = [
  64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840,
]

function smallest(ladder: readonly number[]): number {
  const first = ladder[0]
  if (first === undefined) throw new RangeError('The width ladder is empty')
  return first
}

/**
 * Smallest ladder value that is at least `width`, capped at the largest. The
 * ladder must be sorted ascending. Zero, negative and NaN widths get the
 * smallest value.
 */
export function snapWidth(width: number, ladder: readonly number[] = DEFAULT_WIDTHS): number {
  const min = smallest(ladder)
  if (!(width > min)) return min
  return ladder.find((w) => w >= width) ?? ladder[ladder.length - 1]!
}

/**
 * Largest ladder value the source can fill. The backend never upscales, so
 * widths above `srcWidth` would be the same bytes under another URL. When the
 * source is smaller than the whole ladder, the smallest value is still offered.
 */
function sourceCap(ladder: readonly number[], srcWidth: number | undefined): number {
  const min = smallest(ladder)
  if (srcWidth === undefined) return ladder[ladder.length - 1]!
  return ladder.findLast((w) => w <= srcWidth) ?? min
}

function capped(ladder: readonly number[], cap: number): number[] {
  const widths = ladder.filter((w) => w <= cap)
  return widths.length > 0 ? widths : [smallest(ladder)]
}

export interface MeasuredCandidatesOptions {
  /** Box width in CSS px. */
  measuredWidth: number
  ladder: readonly number[]
  srcWidth?: number
}

/**
 * Candidates for measured mode (spec 6.2): the ladder up to the 2× candidate
 * for the measured width and up to `srcWidth`. A DPR-3 device gets the 2×
 * candidate, since browsers take the largest one when none reaches the DPR.
 */
export function measuredCandidates({ measuredWidth, ladder, srcWidth }: MeasuredCandidatesOptions): number[] {
  const cap = Math.min(snapWidth(2 * measuredWidth, ladder), sourceCap(ladder, srcWidth))
  return capped(ladder, cap)
}

export interface ClassicCandidatesOptions {
  /** The `width` prop in CSS px. */
  width: number
  ladder: readonly number[]
  srcWidth?: number
}

/**
 * Candidates for fixed and ratio images with `width` and no `sizes` in
 * classic mode (spec 6.3): the 1× and 2× snapped widths, each capped at
 * `srcWidth`.
 */
export function classicCandidates({ width, ladder, srcWidth }: ClassicCandidatesOptions): number[] {
  const cap = sourceCap(ladder, srcWidth)
  const widths = [snapWidth(width, ladder), snapWidth(2 * width, ladder)].map((w) => Math.min(w, cap))
  return [...new Set(widths)]
}

export interface FullLadderOptions {
  ladder: readonly number[]
  srcWidth?: number
}

/** Candidates when `sizes` is set (spec 6.3): the whole ladder up to `srcWidth`. */
export function fullLadder({ ladder, srcWidth }: FullLadderOptions): number[] {
  return capped(ladder, sourceCap(ladder, srcWidth))
}

/**
 * @deprecated Pre-revision candidate selection, still used by `Image.tsx`.
 * Step 3 replaces it with `measuredCandidates`, `classicCandidates` and
 * `fullLadder`.
 */
export function candidateWidths(width: number | undefined, widths: readonly number[] = DEFAULT_WIDTHS): number[] {
  if (width === undefined) return [...widths]
  return [...new Set([snapWidth(width, widths), snapWidth(width * 2, widths)])]
}
