const round = (x: number) => Number(x.toFixed(3))

let built: readonly number[] | undefined

/**
 * Crop ratios the backend renders (spec 6.1), 73 values from 0.25 to 4. Part
 * of the loader; the backend must agree. Static data, so importing core
 * computes nothing; `defaultRatios()` builds the same values.
 */
// prettier-ignore
export const DEFAULT_RATIOS: readonly number[] = [
  0.25, 0.261, 0.273, 0.285, 0.297, 0.31, 0.324, 0.339, 0.354, 0.369, 0.386, 0.403, 0.42, 0.429, 0.439,
  0.459, 0.479, 0.5, 0.522, 0.545, 0.563, 0.569, 0.595, 0.621, 0.648, 0.667, 0.677, 0.707, 0.738, 0.75,
  0.771, 0.805, 0.841, 0.878, 0.917, 0.958, 1, 1.044, 1.091, 1.139, 1.189, 1.242, 1.297, 1.333, 1.354,
  1.414, 1.477, 1.5, 1.542, 1.61, 1.682, 1.756, 1.778, 1.834, 1.915, 2, 2.089, 2.181, 2.278, 2.333,
  2.378, 2.484, 2.594, 2.709, 2.828, 2.954, 3.084, 3.221, 3.364, 3.513, 3.668, 3.83, 4,
]

/**
 * The default ratio ladder for core's own defaults, built from its rule on
 * first use. It equals `DEFAULT_RATIOS`, which the tests check. Computing it
 * is smaller in a bundle than the literal, which only bundles that name
 * `DEFAULT_RATIOS` include (the React Image budget depends on this).
 */
export function defaultRatios(): readonly number[] {
  if (built) return built
  const ratios = new Set<number>()
  // 65 log-spaced steps from 0.25 to 4, about 4.4 % apart.
  for (let k = -32; k <= 32; k++) ratios.add(round(2 ** (k / 16)))
  // Common photo and video ratios and their inverses, so they snap with no error at all.
  for (const r of [4 / 3, 3 / 2, 16 / 9, 21 / 9]) ratios.add(round(r)).add(round(1 / r))
  return (built = [...ratios].sort((a, b) => a - b))
}

/**
 * Nearest ladder value to `ratio`. Every layout mode snaps through this, so a
 * 4:3 box is one variant whatever props it came from. The ladder must be
 * sorted ascending. Distance is measured in log space (the ladder is
 * log-spaced, and a crop's visible error is relative); an exact tie goes to
 * the larger value. Ratios outside the ladder clamp to its ends.
 */
export function snapRatio(ratio: number, ladder: readonly number[] = defaultRatios()): number {
  if (!(ratio > 0)) throw new RangeError(`Invalid aspect ratio: ${ratio}`)
  const min = ladder[0]
  if (min === undefined) throw new RangeError('The ratio ladder is empty')
  const index = ladder.findIndex((r) => r >= ratio)
  if (index === -1) return ladder[ladder.length - 1]!
  if (index === 0) return min
  const lower = ladder[index - 1]!
  const upper = ladder[index]!
  // ratio / lower vs upper / ratio, without logarithms or division.
  return ratio * ratio >= lower * upper ? upper : lower
}
