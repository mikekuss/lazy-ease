import { describe, expect, it } from 'vitest'
import { formatNumber } from '../src/numbers.js'
import { DEFAULT_RATIOS, snapRatio } from '../src/ratios.js'
import { DEFAULT_WIDTHS, classicCandidates, fullLadder, measuredCandidates, snapWidth } from '../src/widths.js'

// The contract the backend (step 2) must match value for value.
const RATIO_LADDER = [
  0.25, 0.261, 0.273, 0.285, 0.297, 0.31, 0.324, 0.339, 0.354, 0.369,
  0.386, 0.403, 0.42, 0.429, 0.439, 0.459, 0.479, 0.5, 0.522, 0.545,
  0.563, 0.569, 0.595, 0.621, 0.648, 0.667, 0.677, 0.707, 0.738, 0.75,
  0.771, 0.805, 0.841, 0.878, 0.917, 0.958, 1, 1.044, 1.091, 1.139,
  1.189, 1.242, 1.297, 1.333, 1.354, 1.414, 1.477, 1.5, 1.542, 1.61,
  1.682, 1.756, 1.778, 1.834, 1.915, 2, 2.089, 2.181, 2.278, 2.333,
  2.378, 2.484, 2.594, 2.709, 2.828, 2.954, 3.084, 3.221, 3.364, 3.513,
  3.668, 3.83, 4,
]

describe('DEFAULT_WIDTHS', () => {
  it('is the 13-value ladder from spec 3', () => {
    expect(DEFAULT_WIDTHS).toEqual([64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840])
  })
})

describe('snapWidth', () => {
  it('rounds up to the next ladder value', () => {
    expect(snapWidth(300)).toBe(384)
    expect(snapWidth(1201)).toBe(1440)
    expect(snapWidth(2000)).toBe(2560)
  })

  it('keeps exact ladder values', () => {
    for (const w of DEFAULT_WIDTHS) expect(snapWidth(w)).toBe(w)
  })

  it('caps at the largest value', () => {
    expect(snapWidth(3841)).toBe(3840)
    expect(snapWidth(1e9)).toBe(3840)
    expect(snapWidth(Infinity)).toBe(3840)
  })

  it('gives zero, negative and NaN widths the smallest value', () => {
    expect(snapWidth(0)).toBe(64)
    expect(snapWidth(-50)).toBe(64)
    expect(snapWidth(Number.NaN)).toBe(64)
    expect(snapWidth(0.5)).toBe(64)
  })

  it('uses the given ladder', () => {
    expect(snapWidth(150, [100, 200])).toBe(200)
  })

  it('rejects an empty ladder', () => {
    expect(() => snapWidth(100, [])).toThrow(RangeError)
  })
})

describe('DEFAULT_RATIOS', () => {
  it('matches the 73-value ladder from spec 6.1', () => {
    expect(DEFAULT_RATIOS).toHaveLength(73)
    expect(DEFAULT_RATIOS).toEqual(RATIO_LADDER)
  })

  it('contains the common ratios, their inverses and the powers of two', () => {
    for (const r of [0.25, 0.5, 1, 2, 4, 1.333, 0.75, 1.5, 0.667, 1.778, 0.563, 2.333, 0.429]) {
      expect(DEFAULT_RATIOS).toContain(r)
    }
  })

  it('is already in canonical form', () => {
    for (const r of DEFAULT_RATIOS) expect(String(r)).toBe(formatNumber(r))
  })
})

describe('snapRatio', () => {
  it('keeps ladder values', () => {
    for (const r of DEFAULT_RATIOS) expect(snapRatio(r)).toBe(r)
  })

  it('snaps common ratios exactly', () => {
    expect(snapRatio(4 / 3)).toBe(1.333)
    expect(snapRatio(3 / 4)).toBe(0.75)
    expect(snapRatio(16 / 9)).toBe(1.778)
    expect(snapRatio(9 / 16)).toBe(0.563)
    expect(snapRatio(21 / 9)).toBe(2.333)
    expect(snapRatio(320 / 240)).toBe(1.333)
  })

  it('snaps to the nearest value in log space', () => {
    // Geometric mean of 1 and 1.044 is 1.02176; linear midpoint is 1.022.
    expect(snapRatio(1.0217)).toBe(1)
    expect(snapRatio(1.0218)).toBe(1.044)
    expect(snapRatio(1.022)).toBe(1.044)
  })

  it('stays within the 2.2 % error bound', () => {
    for (let r = 0.25; r <= 4; r *= 1.003) {
      const snapped = snapRatio(r)
      expect(Math.abs(Math.log(snapped / r))).toBeLessThan(Math.log(1.022) + 1e-3)
    }
  })

  it('sends an exact tie to the larger value', () => {
    expect(snapRatio(2, [1, 4])).toBe(4)
    expect(snapRatio(1.999, [1, 4])).toBe(1)
  })

  it('clamps ratios outside 0.25–4', () => {
    expect(snapRatio(0.1)).toBe(0.25)
    expect(snapRatio(0.2499)).toBe(0.25)
    expect(snapRatio(4.01)).toBe(4)
    expect(snapRatio(100)).toBe(4)
    expect(snapRatio(Infinity)).toBe(4)
  })

  it('rejects ratios that are not positive numbers', () => {
    expect(() => snapRatio(0)).toThrow(RangeError)
    expect(() => snapRatio(-1)).toThrow(RangeError)
    expect(() => snapRatio(Number.NaN)).toThrow(RangeError)
    expect(() => snapRatio(1, [])).toThrow(RangeError)
  })
})

describe('measuredCandidates', () => {
  const ladder = DEFAULT_WIDTHS

  it('offers the ladder up to the 2× candidate', () => {
    // 2 × 412 = 824 → 828
    expect(measuredCandidates({ measuredWidth: 412, ladder })).toEqual([64, 128, 256, 384, 640, 750, 828])
    expect(measuredCandidates({ measuredWidth: 320, ladder })).toEqual([64, 128, 256, 384, 640])
  })

  it('caps at srcWidth', () => {
    expect(measuredCandidates({ measuredWidth: 1000, ladder, srcWidth: 800 })).toEqual([64, 128, 256, 384, 640, 750])
    expect(measuredCandidates({ measuredWidth: 1000, ladder, srcWidth: 828 })).toEqual([
      64, 128, 256, 384, 640, 750, 828,
    ])
  })

  it('offers the smallest value when srcWidth is below the ladder', () => {
    expect(measuredCandidates({ measuredWidth: 1000, ladder, srcWidth: 40 })).toEqual([64])
  })

  it('offers the whole ladder for huge widths', () => {
    expect(measuredCandidates({ measuredWidth: 1e7, ladder })).toEqual([...ladder])
  })

  it('offers the smallest value for a zero width', () => {
    expect(measuredCandidates({ measuredWidth: 0, ladder })).toEqual([64])
  })
})

describe('classicCandidates', () => {
  const ladder = DEFAULT_WIDTHS

  it('returns snap(w) and snap(2w)', () => {
    expect(classicCandidates({ width: 320, ladder })).toEqual([384, 640])
    expect(classicCandidates({ width: 640, ladder })).toEqual([640, 1440])
  })

  it('deduplicates at the top of the ladder', () => {
    expect(classicCandidates({ width: 2000, ladder })).toEqual([2560, 3840])
    expect(classicCandidates({ width: 3000, ladder })).toEqual([3840])
    expect(classicCandidates({ width: 1e9, ladder })).toEqual([3840])
  })

  it('caps both at srcWidth', () => {
    expect(classicCandidates({ width: 320, ladder, srcWidth: 500 })).toEqual([384])
    expect(classicCandidates({ width: 320, ladder, srcWidth: 300 })).toEqual([256])
    expect(classicCandidates({ width: 320, ladder, srcWidth: 10 })).toEqual([64])
  })

  it('handles a zero width', () => {
    expect(classicCandidates({ width: 0, ladder })).toEqual([64])
  })
})

describe('fullLadder', () => {
  it('returns the whole ladder without srcWidth', () => {
    expect(fullLadder({ ladder: DEFAULT_WIDTHS })).toEqual([...DEFAULT_WIDTHS])
  })

  it('caps at srcWidth', () => {
    expect(fullLadder({ ladder: DEFAULT_WIDTHS, srcWidth: 1000 })).toEqual([64, 128, 256, 384, 640, 750, 828])
    expect(fullLadder({ ladder: DEFAULT_WIDTHS, srcWidth: 5 })).toEqual([64])
  })
})

describe('formatNumber', () => {
  it('drops trailing zeros', () => {
    expect(formatNumber(1.5)).toBe('1.5')
    expect(formatNumber(1.5)).not.toBe('1.50')
    expect(formatNumber(640)).toBe('640')
    expect(formatNumber(2)).toBe('2')
  })

  it('rounds to at most 3 decimals', () => {
    expect(formatNumber(4 / 3)).toBe('1.333')
    expect(formatNumber(16 / 9)).toBe('1.778')
    expect(formatNumber(1.0004)).toBe('1')
    expect(formatNumber(0.0004)).toBe('0')
  })

  it('never uses an exponent', () => {
    expect(formatNumber(1e-7)).toBe('0')
    expect(formatNumber(1e21)).toBe('1000000000000000000000')
    expect(formatNumber(123456789012)).toBe('123456789012')
  })

  it('normalizes zero and negatives', () => {
    expect(formatNumber(-0)).toBe('0')
    expect(formatNumber(-0.0001)).toBe('0')
    expect(formatNumber(-1.25)).toBe('-1.25')
  })

  it('rejects non-finite numbers', () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError)
    expect(() => formatNumber(Infinity)).toThrow(RangeError)
  })
})
