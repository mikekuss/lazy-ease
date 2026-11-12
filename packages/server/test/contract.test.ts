import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUALITIES,
  DEFAULT_RATIOS,
  DEFAULT_WIDTHS,
  formatNumber,
  parseImageQuery,
} from '../src/contract.js'

// The same literal as `RATIO_LADDER` in packages/core/test/ladders.test.ts.
// The server takes its ladders from @lazy-ease/core; this pins the values it accepts.
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

const ladders = { widths: DEFAULT_WIDTHS, ratios: DEFAULT_RATIOS, qualities: DEFAULT_QUALITIES }
const parse = (query: string) => parseImageQuery(query, ladders)

describe('ladders', () => {
  it('has the 13-value width ladder from spec 3', () => {
    expect(DEFAULT_WIDTHS).toEqual([64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840])
  })

  it('has the 73-value ratio ladder the client asserts', () => {
    expect(RATIO_LADDER).toHaveLength(73)
    expect(DEFAULT_RATIOS).toEqual(RATIO_LADDER)
  })

  it('stores ratios in canonical form', () => {
    for (const r of DEFAULT_RATIOS) expect(formatNumber(r)).toBe(String(r))
  })

  it('defaults qualities to [75]', () => {
    expect(DEFAULT_QUALITIES).toEqual([75])
  })
})

describe('formatNumber', () => {
  it.each([
    [1.5, '1.5'],
    [1.5004, '1.5'],
    [1.3333, '1.333'],
    [640, '640'],
    [-0, '0'],
    [1e21, '1000000000000000000000'],
  ])('writes %s as %s', (n, text) => {
    expect(formatNumber(n)).toBe(text)
  })

  it('rejects non-finite numbers', () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError)
  })
})

describe('parseImageQuery', () => {
  it('accepts the full canonical query', () => {
    expect(parse('ar=1.333&fmt=webp&q=75&v=AbC-1_2.3~&w=640')).toEqual({
      width: 640,
      aspectRatio: 1.333,
      quality: 75,
      format: 'webp',
      version: 'AbC-1_2.3~',
    })
  })

  it('accepts the minimal query', () => {
    expect(parse('fmt=jpeg&q=75&w=64')).toEqual({ width: 64, quality: 75, format: 'jpeg' })
    expect(parseImageQuery('fmt=jpeg&q=90&w=64', { ...ladders, qualities: [50, 90] }).quality).toBe(90)
  })

  it('requires q', () => {
    expect(() => parse('fmt=jpeg&w=64')).toThrow('Missing q')
  })

  it('accepts a token between q and v', () => {
    expect(parse('ar=1&fmt=webp&q=75&token=1.k1.WisYCsz8Vtmygcbr01tTuA&v=r7&w=640').token).toBe('1.k1.WisYCsz8Vtmygcbr01tTuA')
    expect(() => parse('ar=1&fmt=webp&q=75&v=r7&token=1.k1.WisYCsz8Vtmygcbr01tTuA&w=640')).toThrow('alphabetical')
    expect(() => parse('fmt=webp&q=75&token=1.k1.short&w=640')).toThrow('Malformed token')
  })

  it('accepts only the configured formats', () => {
    const webpOnly = { ...ladders, formats: ['webp', 'jpeg'] as const }
    expect(parseImageQuery('fmt=webp&q=75&w=64', webpOnly).format).toBe('webp')
    expect(() => parseImageQuery('fmt=avif&q=75&w=64', webpOnly)).toThrow('fmt must be one of webp, jpeg')
  })

  it('accepts every ladder width, ratio and format', () => {
    for (const w of DEFAULT_WIDTHS) expect(parse(`fmt=avif&q=75&w=${w}`).width).toBe(w)
    for (const ar of DEFAULT_RATIOS) expect(parse(`ar=${ar}&fmt=avif&q=75&w=64`).aspectRatio).toBe(ar)
    for (const fmt of ['avif', 'webp', 'jpeg']) expect(parse(`fmt=${fmt}&q=75&w=64`).format).toBe(fmt)
  })

  it('accepts custom ladders', () => {
    const custom = { widths: [100, 200.5], ratios: [1, 2.5], qualities: [40, 80] }
    expect(parseImageQuery('ar=2.5&fmt=webp&q=80&w=200.5', custom)).toMatchObject({
      width: 200.5,
      aspectRatio: 2.5,
      quality: 80,
    })
    expect(() => parseImageQuery('fmt=webp&q=75&w=640', custom)).toThrow()
  })

  it('keeps the case of v', () => {
    expect(parse('fmt=webp&q=75&v=AbC123&w=640').version).toBe('AbC123')
    expect(parse(`fmt=webp&q=75&v=${'a'.repeat(64)}&w=640`).version).toHaveLength(64)
  })

  const rejects = (query: string) => {
    let status: number | undefined
    try {
      parse(query)
    } catch (error) {
      status = (error as { status?: number }).status
    }
    expect(status, query).toBe(400)
  }

  it.each([
    // missing or empty
    [''],
    ['fmt=webp&q=75'],
    ['w=640'],
    ['fmt=&q=75&w=640'],
    ['fmt=webp&q=75&w='],
    ['fmt=webp&q=75&w'],
    ['fmt=webp&q=75&w=640&'],
    ['&fmt=webp&q=75&w=640'],
    ['fmt=webp&&q=75&w=640'],
  ])('rejects the incomplete query %j', rejects)

  it.each([
    ['w=640&fmt=webp'],
    ['fmt=webp&ar=1&q=75&w=640'],
    ['ar=1&q=75&fmt=webp&w=640'],
    ['ar=1&fmt=webp&q=75&w=640&v=x'],
  ])('rejects the out-of-order query %j', rejects)

  it.each([
    ['fmt=webp&q=75&w=640&w=640'],
    ['fmt=webp&fmt=webp&q=75&w=640'],
    ['ar=1&ar=1&fmt=webp&q=75&w=640'],
  ])('rejects the duplicate in %j', rejects)

  it.each([
    ['fmt=webp&W=640&q=75'],
    ['FMT=webp&w=640'],
    ['fmt=WEBP&q=75&w=640'],
    ['fmt=Webp&q=75&w=640'],
  ])('rejects the non-lowercase %j', rejects)

  it.each([
    ['fmt=webp&q=75&w=0640'],
    ['fmt=webp&q=75&w=640.0'],
    ['fmt=webp&q=75&w=640.'],
    ['fmt=webp&q=75&w=+640'],
    ['fmt=webp&q=75&w=6.4e2'],
    ['fmt=webp&q=75&w=%36%34%30'],
    ['fmt=webp&q=75&w=640%20'],
    ['ar=1.50&fmt=webp&q=75&w=640'],
    ['ar=1.500&fmt=webp&q=75&w=640'],
    ['ar=01.5&fmt=webp&q=75&w=640'],
    ['ar=.5&fmt=webp&q=75&w=640'],
    ['ar=1.0&fmt=webp&q=75&w=640'],
    ['ar=1.3333&fmt=webp&q=75&w=640'],
    ['fmt=webp&q=075&w=640'],
    ['fmt=webp&q=75.0&w=640'],
  ])('rejects the non-canonical number in %j', rejects)

  it.each([
    ['fmt=webp&q=75&w=500'],
    ['fmt=webp&q=75&w=4000'],
    ['fmt=webp&q=75&w=-64'],
    ['ar=1.6&fmt=webp&q=75&w=640'],
    ['ar=5&fmt=webp&q=75&w=640'],
    ['ar=0.2&fmt=webp&q=75&w=640'],
    ['ar=0&fmt=webp&q=75&w=640'],
    ['fmt=webp&q=80&w=640'],
    ['fmt=webp&q=100&w=640'],
  ])('rejects the off-ladder value in %j', rejects)

  it.each([
    ['fmt=auto&q=75&w=640'],
    ['fmt=png&q=75&w=640'],
    ['fmt=gif&q=75&w=640'],
    ['fmt=jpg&q=75&w=640'],
  ])('rejects the format in %j', rejects)

  it.each([
    ['fmt=webp&q=75&v=&w=640'],
    [`fmt=webp&v=${'a'.repeat(65)}&w=640`],
    ['fmt=webp&q=75&v=a%2Bb&w=640'],
    ['fmt=webp&q=75&v=a+b&w=640'],
    ['fmt=webp&q=75&v=a/b&w=640'],
    ['fmt=webp&q=75&v=abc%3D&w=640'],
  ])('rejects the version in %j', rejects)

  it.each([
    ['fmt=webp&h=480&q=75&w=640'],
    ['fmt=webp&src=/a.jpg&q=75&w=640'],
    ['fmt=webp&run=1&q=75&w=640'],
    ['a=1&fmt=webp&w=640'],
    ['fmt=webp&q=75&w=640&x=1'],
  ])('rejects the unknown parameter in %j', rejects)
})

describe('focal point parameters', () => {
  it('accepts fx and fy with ar', () => {
    expect(parse('ar=1.5&fmt=webp&fx=30&fy=70&q=75&w=640').focalPoint).toEqual({ x: 30, y: 70 })
    expect(parse('ar=1&fmt=webp&fx=0&fy=100&q=75&w=640').focalPoint).toEqual({ x: 0, y: 100 })
    expect(parse('ar=1&fmt=webp&fx=50&fy=10&q=75&w=640').focalPoint).toEqual({ x: 50, y: 10 })
  })

  it('has no focal point without them', () => {
    expect(parse('ar=1.5&fmt=webp&q=75&w=640').focalPoint).toBeUndefined()
  })

  it.each([
    ['fmt=webp&fx=30&fy=70&q=75&w=640', 'require ar'],
    ['ar=1&fmt=webp&fx=30&q=75&w=640', 'together'],
    ['ar=1&fmt=webp&fy=30&q=75&w=640', 'together'],
    ['ar=1&fmt=webp&fx=50&fy=50&q=75&w=640', 'omit'],
    ['ar=1&fmt=webp&fx=030&fy=70&q=75&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fx=30.5&fy=70&q=75&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fx=101&fy=70&q=75&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fx=-1&fy=70&q=75&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fy=70&fx=30&q=75&w=640', 'alphabetical'],
  ])('rejects %s', (query, message) => {
    expect(() => parse(query)).toThrow(message)
  })
})
