const round = (x: number) => Number(x.toFixed(3))

function buildRatios(): number[] {
  const ratios = new Set<number>()
  // 65 log-spaced steps from 0.25 to 4, about 4.4 % apart.
  for (let k = -32; k <= 32; k++) ratios.add(round(2 ** (k / 16)))
  // Common photo and video ratios, so they snap with no error at all.
  for (const r of [4 / 3, 3 / 2, 16 / 9, 21 / 9]) {
    ratios.add(round(r))
    ratios.add(round(1 / r))
  }
  return [...ratios].sort((a, b) => a - b)
}

/**
 * Crop ratios the backend renders (spec 6.1), 73 values from 0.25 to 4. Part
 * of the loader; the backend must agree.
 */
export const DEFAULT_RATIOS: readonly number[] = buildRatios()

/**
 * Nearest ladder value to `ratio`. Every layout mode snaps through this, so a
 * 4:3 box is one variant whatever props it came from. The ladder must be
 * sorted ascending. Distance is measured in log space (the ladder is
 * log-spaced, and a crop's visible error is relative); an exact tie goes to
 * the larger value. Ratios outside the ladder clamp to its ends.
 */
export function snapRatio(ratio: number, ladder: readonly number[] = DEFAULT_RATIOS): number {
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
