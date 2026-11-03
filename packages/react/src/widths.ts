/**
 * Widths the image server is allowed to render. A fixed list keeps the number
 * of cached variants per image small. Keep in sync with @lazy-ease/server.
 */
export const DEFAULT_WIDTHS: readonly number[] = [
  64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
]

/** Smallest allowed width that is at least `width` (or the largest one). */
export function snapWidth(width: number, widths: readonly number[] = DEFAULT_WIDTHS): number {
  return widths.find((w) => w >= width) ?? widths[widths.length - 1] ?? width
}

/**
 * Widths to put in the srcset. A fixed-width image only needs its 1x and 2x
 * variants; a fluid image gets the whole list and lets `sizes` decide.
 */
export function candidateWidths(
  width: number | undefined,
  widths: readonly number[] = DEFAULT_WIDTHS,
): number[] {
  if (width === undefined) return [...widths]
  return [...new Set([snapWidth(width, widths), snapWidth(width * 2, widths)])]
}
