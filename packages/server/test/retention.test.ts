import { describe, expect, it } from 'vitest'
import { Retention, resolveLimits, type RetentionOptions } from '../src/retention.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const make = (options: RetentionOptions) => new Retention(resolveLimits(options, { maxBytes: 1000, maxEntries: 100 }))
const keys = (entries: { key: string }[]) => entries.map((e) => e.key)

describe('retention limits', () => {
  it('defaults the source quota to an eighth of the byte cap and cold expiry to 30 days', () => {
    expect(resolveLimits({}, { maxBytes: 800, maxEntries: 5 })).toEqual({ maxBytes: 800, maxEntries: 5, maxSourceBytes: 100, maxAge: 30 * DAY, promote: undefined })
    expect(resolveLimits({ promote: true }, { maxBytes: 8, maxEntries: 1 }).promote).toEqual({ hits: 3, window: HOUR, perSource: 8 })
  })

  it('rejects limits that are not non-negative integers', () => {
    for (const bad of [{ maxBytes: -1 }, { maxEntries: 1.5 }, { maxSourceBytes: Number.NaN }, { maxAge: Infinity }]) {
      expect(() => resolveLimits(bad, { maxBytes: 1, maxEntries: 1 })).toThrow(RangeError)
    }
    expect(() => resolveLimits({ promote: { hits: 0 } }, { maxBytes: 1, maxEntries: 1 })).toThrow(RangeError)
  })

  it('refuses variants larger than the byte cap or the source quota', () => {
    const r = make({ maxBytes: 100, maxSourceBytes: 50 })
    expect(r.fits(50)).toBe(true)
    expect(r.fits(51)).toBe(false)
    expect(make({ maxBytes: 0 }).fits(0)).toBe(true)
    expect(make({ maxEntries: 0 }).fits(1)).toBe(false)
  })
})

describe('retention eviction', () => {
  it('evicts the least recently used variant at the byte cap', () => {
    const r = make({ maxBytes: 300, maxSourceBytes: 300 })
    r.add('a', 's', 100, 1, 1)
    r.add('b', 's', 100, 2, 2)
    r.add('c', 's', 100, 3, 3)
    r.touch('a', 4)
    expect(keys(r.add('d', 's', 100, 5, 5))).toEqual(['b'])
    expect(r.bytes).toBe(300)
    expect(r.size).toBe(3)
  })

  it('caps the number of variants', () => {
    const r = make({ maxEntries: 2 })
    r.add('a', 's', 1, 1, 1)
    r.add('b', 's', 1, 2, 2)
    expect(keys(r.add('c', 't', 1, 3, 3))).toEqual(['a'])
  })

  it('counts a key added twice once', () => {
    const r = make({})
    r.add('a', 's', 40, 1, 1)
    expect(r.add('a', 's', 60, 2, 2)).toEqual([])
    expect(r.bytes).toBe(60)
    expect(r.size).toBe(1)
    expect(r.remove('a')?.bytes).toBe(60)
    expect(r.bytes).toBe(0)
    expect(r.remove('a')).toBeUndefined()
  })

  it('applies the source quota to each source on its own', () => {
    const r = make({ maxBytes: 1000, maxSourceBytes: 200 })
    r.add('x1', 'x', 100, 1, 1)
    r.add('y1', 'y', 100, 2, 2)
    r.add('x2', 'x', 100, 3, 3)
    // The third variant of x evicts x's oldest, not y's older one.
    expect(keys(r.add('x3', 'x', 100, 4, 4))).toEqual(['x1'])
    expect(r.get('y1')).toBeDefined()
    expect(r.bytes).toBe(300)
  })

  it('expires variants unused for maxAge, at most once a minute', () => {
    const r = make({ maxAge: DAY })
    r.add('old', 's', 1, 0, 0)
    r.add('new', 's', 1, DAY, DAY)
    // The add at DAY scanned already; within a minute nothing is scanned again.
    expect(r.expire(DAY + 1)).toEqual([])
    expect(keys(r.expire(DAY + 2 * 60_000))).toEqual(['old'])
    expect(keys(r.expire(3 * DAY, true))).toEqual(['new'])
    expect(r.size).toBe(0)
  })
})

describe('retention promotion', () => {
  const promote = { hits: 2, window: HOUR, perSource: 1 }

  it('keeps a promoted variant past newer unpromoted ones', () => {
    const r = make({ maxBytes: 300, maxSourceBytes: 300, promote })
    r.add('pop', 's', 100, 1, 1)
    r.add('b', 's', 100, 2, 2)
    r.add('c', 's', 100, 3, 3)
    r.touch('pop', 4)
    r.touch('pop', 5)
    expect(r.get('pop')?.promoted).toBe(true)
    // Plain recency would evict b now; pop is older but promoted.
    r.touch('b', 6)
    r.touch('c', 7)
    expect(keys(r.add('d', 's', 100, 8, 8))).toEqual(['b'])
  })

  it('promotes at most perSource variants of a source', () => {
    const r = make({ maxBytes: 1000, maxSourceBytes: 1000, promote })
    r.add('a', 's', 1, 1, 1)
    r.add('b', 's', 1, 1, 1)
    r.touch('a', 2)
    r.touch('a', 3)
    r.touch('b', 4)
    r.touch('b', 5)
    expect([r.get('a')?.promoted, r.get('b')?.promoted]).toEqual([false, true])
  })

  it('needs the hits within one window', () => {
    const r = make({ promote })
    r.add('a', 's', 1, 0, 0)
    r.touch('a', 1)
    r.touch('a', HOUR + 2)
    expect(r.get('a')?.promoted).toBe(false)
    r.touch('a', HOUR + 3)
    expect(r.get('a')?.promoted).toBe(true)
  })

  it('evicts promoted variants at the hard limit once nothing else is left', () => {
    const r = make({ maxBytes: 200, maxSourceBytes: 200, promote: { ...promote, perSource: 8 } })
    r.add('a', 's', 100, 1, 1)
    r.add('b', 's', 100, 2, 2)
    for (const key of ['a', 'b']) {
      r.touch(key, 3)
      r.touch(key, 4)
    }
    expect(r.promotedBytes).toBe(200)
    // Promoted variants are over their 80% share, so the oldest of them goes first.
    expect(keys(r.add('c', 's', 100, 5, 5))).toEqual(['a'])
    expect(r.bytes).toBe(200)
  })

  it('demotes a promoted variant that missed two windows, and expires it like any other', () => {
    const r = make({ maxAge: DAY, promote })
    r.add('a', 's', 1, 0, 0)
    r.touch('a', 1)
    r.touch('a', 2)
    r.expire(2 * HOUR + 2, true)
    expect(r.get('a')?.promoted).toBe(false)
    r.touch('a', 3 * HOUR)
    r.touch('a', 3 * HOUR + 1)
    expect(r.get('a')?.promoted).toBe(true)
    expect(keys(r.expire(2 * DAY, true))).toEqual(['a'])
  })
})
