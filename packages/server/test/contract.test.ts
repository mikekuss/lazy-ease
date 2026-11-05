import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUALITIES,
  DEFAULT_RATIOS,
  DEFAULT_WIDTHS,
  formatNumber,
  parseImageQuery,
} from '../src/contract.js'

// The same literal as `RATIO_LADDER` in packages/react/test/ladders.test.ts.
// Client and server must agree, and the server does not import the client.
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

  it('accepts the minimal query and defaults q to the first allowed quality', () => {
    expect(parse('fmt=jpeg&w=64')).toEqual({ width: 64, quality: 75, format: 'jpeg' })
    expect(parseImageQuery('fmt=jpeg&w=64', { ...ladders, qualities: [50, 90] }).quality).toBe(50)
  })

  it('accepts every ladder width, ratio and format', () => {
    for (const w of DEFAULT_WIDTHS) expect(parse(`fmt=avif&w=${w}`).width).toBe(w)
    for (const ar of DEFAULT_RATIOS) expect(parse(`ar=${ar}&fmt=avif&w=64`).aspectRatio).toBe(ar)
    for (const fmt of ['avif', 'webp', 'jpeg']) expect(parse(`fmt=${fmt}&w=64`).format).toBe(fmt)
  })

  it('accepts custom ladders', () => {
    const custom = { widths: [100, 200.5], ratios: [1, 2.5], qualities: [40, 80] }
    expect(parseImageQuery('ar=2.5&fmt=webp&q=80&w=200.5', custom)).toMatchObject({
      width: 200.5,
      aspectRatio: 2.5,
      quality: 80,
    })
    expect(() => parseImageQuery('fmt=webp&w=640', custom)).toThrow()
  })

  it('keeps the case of v', () => {
    expect(parse('fmt=webp&v=AbC123&w=640').version).toBe('AbC123')
    expect(parse(`fmt=webp&v=${'a'.repeat(64)}&w=640`).version).toHaveLength(64)
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
    ['fmt=webp'],
    ['w=640'],
    ['fmt=&w=640'],
    ['fmt=webp&w='],
    ['fmt=webp&w'],
    ['fmt=webp&w=640&'],
    ['&fmt=webp&w=640'],
    ['fmt=webp&&w=640'],
  ])('rejects the incomplete query %j', rejects)

  it.each([
    ['w=640&fmt=webp'],
    ['fmt=webp&ar=1&w=640'],
    ['ar=1&q=75&fmt=webp&w=640'],
    ['ar=1&fmt=webp&w=640&v=x'],
  ])('rejects the out-of-order query %j', rejects)

  it.each([
    ['fmt=webp&w=640&w=640'],
    ['fmt=webp&fmt=webp&w=640'],
    ['ar=1&ar=1&fmt=webp&w=640'],
  ])('rejects the duplicate in %j', rejects)

  it.each([
    ['fmt=webp&W=640'],
    ['FMT=webp&w=640'],
    ['fmt=WEBP&w=640'],
    ['fmt=Webp&w=640'],
  ])('rejects the non-lowercase %j', rejects)

  it.each([
    ['fmt=webp&w=0640'],
    ['fmt=webp&w=640.0'],
    ['fmt=webp&w=640.'],
    ['fmt=webp&w=+640'],
    ['fmt=webp&w=6.4e2'],
    ['fmt=webp&w=%36%34%30'],
    ['fmt=webp&w=640%20'],
    ['ar=1.50&fmt=webp&w=640'],
    ['ar=1.500&fmt=webp&w=640'],
    ['ar=01.5&fmt=webp&w=640'],
    ['ar=.5&fmt=webp&w=640'],
    ['ar=1.0&fmt=webp&w=640'],
    ['ar=1.3333&fmt=webp&w=640'],
    ['fmt=webp&q=075&w=640'],
    ['fmt=webp&q=75.0&w=640'],
  ])('rejects the non-canonical number in %j', rejects)

  it.each([
    ['fmt=webp&w=500'],
    ['fmt=webp&w=4000'],
    ['fmt=webp&w=-64'],
    ['ar=1.6&fmt=webp&w=640'],
    ['ar=5&fmt=webp&w=640'],
    ['ar=0.2&fmt=webp&w=640'],
    ['ar=0&fmt=webp&w=640'],
    ['fmt=webp&q=80&w=640'],
    ['fmt=webp&q=100&w=640'],
  ])('rejects the off-ladder value in %j', rejects)

  it.each([
    ['fmt=auto&w=640'],
    ['fmt=png&w=640'],
    ['fmt=gif&w=640'],
    ['fmt=jpg&w=640'],
  ])('rejects the format in %j', rejects)

  it.each([
    ['fmt=webp&v=&w=640'],
    [`fmt=webp&v=${'a'.repeat(65)}&w=640`],
    ['fmt=webp&v=a%2Bb&w=640'],
    ['fmt=webp&v=a+b&w=640'],
    ['fmt=webp&v=a/b&w=640'],
    ['fmt=webp&v=abc%3D&w=640'],
  ])('rejects the version in %j', rejects)

  it.each([
    ['fmt=webp&h=480&w=640'],
    ['fmt=webp&src=/a.jpg&w=640'],
    ['fmt=webp&run=1&w=640'],
    ['a=1&fmt=webp&w=640'],
    ['fmt=webp&w=640&x=1'],
  ])('rejects the unknown parameter in %j', rejects)
})

describe('focal point parameters', () => {
  it('accepts fx and fy with ar', () => {
    expect(parse('ar=1.5&fmt=webp&fx=30&fy=70&q=75&w=640').focalPoint).toEqual({ x: 30, y: 70 })
    expect(parse('ar=1&fmt=webp&fx=0&fy=100&w=640').focalPoint).toEqual({ x: 0, y: 100 })
    expect(parse('ar=1&fmt=webp&fx=50&fy=10&w=640').focalPoint).toEqual({ x: 50, y: 10 })
  })

  it('has no focal point without them', () => {
    expect(parse('ar=1.5&fmt=webp&w=640').focalPoint).toBeUndefined()
  })

  it.each([
    ['fmt=webp&fx=30&fy=70&w=640', 'require ar'],
    ['ar=1&fmt=webp&fx=30&w=640', 'together'],
    ['ar=1&fmt=webp&fy=30&w=640', 'together'],
    ['ar=1&fmt=webp&fx=50&fy=50&w=640', 'omit'],
    ['ar=1&fmt=webp&fx=030&fy=70&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fx=30.5&fy=70&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fx=101&fy=70&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fx=-1&fy=70&w=640', 'whole numbers'],
    ['ar=1&fmt=webp&fy=70&fx=30&w=640', 'alphabetical'],
  ])('rejects %s', (query, message) => {
    expect(() => parse(query)).toThrow(message)
  })
})
