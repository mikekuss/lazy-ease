import { describe, expect, it } from 'vitest'
import { createLoader, normalizeLoader, snapQuality, type ImageRequest } from '../src/loader.js'
import { DEFAULT_RATIOS } from '../src/ratios.js'
import { buildSrcSet } from '../src/srcset.js'
import { DEFAULT_WIDTHS } from '../src/widths.js'

const base: ImageRequest = { src: '/photos/lake.jpg', width: 640, quality: 75, format: 'webp' }

describe('createLoader', () => {
  const loader = createLoader()

  it('emits the canonical URL with the source path in the URL path', () => {
    expect(loader.url(base)).toBe('/_img/photos/lake.jpg?fmt=webp&q=75&w=640')
  })

  it('orders every parameter combination alphabetically and omits absent ones', () => {
    const cases: [Partial<ImageRequest>, string][] = [
      [{}, 'fmt=webp&q=75&w=640'],
      [{ aspectRatio: 1.5 }, 'ar=1.5&fmt=webp&q=75&w=640'],
      [{ version: 'abc123' }, 'fmt=webp&q=75&v=abc123&w=640'],
      [{ aspectRatio: 1.778, version: 'abc123' }, 'ar=1.778&fmt=webp&q=75&v=abc123&w=640'],
      [{ aspectRatio: 0.25, format: 'avif' }, 'ar=0.25&fmt=avif&q=75&w=640'],
      [{ format: 'jpeg', quality: 50 }, 'fmt=jpeg&q=50&w=640'],
      [{ format: 'auto' }, 'fmt=auto&q=75&w=640'],
      [{ aspectRatio: undefined, version: undefined }, 'fmt=webp&q=75&w=640'],
      [{ version: '' }, 'fmt=webp&q=75&w=640'],
    ]
    for (const [request, query] of cases) {
      expect(loader.url({ ...base, ...request })).toBe(`/_img/photos/lake.jpg?${query}`)
    }
  })

  it('writes numbers in canonical form', () => {
    expect(loader.url({ ...base, aspectRatio: 4 / 3 })).toContain('ar=1.333&')
    expect(loader.url({ ...base, aspectRatio: 2 })).toContain('ar=2&')
    expect(loader.url({ ...base, quality: 80.0 })).toContain('q=80&')
  })

  it('encodes each path segment and keeps the extension last', () => {
    expect(loader.url({ ...base, src: '/my photos/a b,c.jpg' })).toBe(
      '/_img/my%20photos/a%20b%2Cc.jpg?fmt=webp&q=75&w=640',
    )
    expect(loader.url({ ...base, src: '/fotos/café.jpg' })).toBe('/_img/fotos/caf%C3%A9.jpg?fmt=webp&q=75&w=640')
    expect(loader.url({ ...base, src: '/a%20b.jpg' })).toBe('/_img/a%20b.jpg?fmt=webp&q=75&w=640')
    expect(loader.url({ ...base, src: '/100%.jpg' })).toBe('/_img/100%25.jpg?fmt=webp&q=75&w=640')
    expect(loader.url({ ...base, src: "/(it's).jpg" })).toBe('/_img/(it\'s).jpg?fmt=webp&q=75&w=640')
  })

  it('resolves relative paths and dot segments', () => {
    expect(loader.url({ ...base, src: 'photos/lake.jpg' })).toBe('/_img/photos/lake.jpg?fmt=webp&q=75&w=640')
    expect(loader.url({ ...base, src: '/a/../b/./c.jpg' })).toBe('/_img/b/c.jpg?fmt=webp&q=75&w=640')
  })

  it('drops the query and hash of the source', () => {
    expect(loader.url({ ...base, src: '/a.jpg?x=1#top' })).toBe('/_img/a.jpg?fmt=webp&q=75&w=640')
  })

  it('strips the origin of an absolute URL', () => {
    expect(loader.url({ ...base, src: 'https://CDN.example.com:8443/photos/lake.jpg?x=1' })).toBe(
      '/_img/photos/lake.jpg?fmt=webp&q=75&w=640',
    )
  })

  it('trims trailing slashes from baseUrl', () => {
    expect(createLoader({ baseUrl: '/img/' }).url(base)).toBe('/img/photos/lake.jpg?fmt=webp&q=75&w=640')
    expect(createLoader({ baseUrl: 'https://img.example.com/' }).url(base)).toBe(
      'https://img.example.com/photos/lake.jpg?fmt=webp&q=75&w=640',
    )
    expect(createLoader({ baseUrl: '' }).url(base)).toBe('/photos/lake.jpg?fmt=webp&q=75&w=640')
  })

  it('sorts extra params in with lowercase names and canonical numbers', () => {
    const withParams = createLoader({ params: { Run: 2, delay: 1.50, z: 'x y' } })
    expect(withParams.url(base)).toBe('/_img/photos/lake.jpg?delay=1.5&fmt=webp&q=75&run=2&w=640&z=x%20y')
  })

  it('does not let params override the contract parameters', () => {
    const loader = createLoader({ params: { w: 9999, FMT: 'png' } })
    expect(loader.url(base)).toBe('/_img/photos/lake.jpg?fmt=webp&q=75&w=640')
  })

  it('declares the default ladders, quality and formats', () => {
    expect(loader.widths).toBe(DEFAULT_WIDTHS)
    expect(loader.ratios).toEqual(DEFAULT_RATIOS)
    expect(loader.qualities).toEqual([75])
    expect(loader.formats).toEqual(['avif', 'webp', 'jpeg'])
  })

  it('declares custom ladders', () => {
    const custom = createLoader({ widths: [100, 200], ratios: [1, 2], qualities: [50, 80] })
    expect(custom.widths).toEqual([100, 200])
    expect(custom.ratios).toEqual([1, 2])
    expect(custom.qualities).toEqual([50, 80])
  })
})

describe('normalizeLoader', () => {
  it('gives the function shorthand the defaults', () => {
    const url = (request: ImageRequest) => `https://cdn.test${request.src}?w=${request.width}`
    const loader = normalizeLoader(url)
    expect(loader.url(base)).toBe('https://cdn.test/photos/lake.jpg?w=640')
    expect(loader.widths).toBe(DEFAULT_WIDTHS)
    expect(loader.ratios).toEqual(DEFAULT_RATIOS)
    expect(loader.qualities).toEqual([75])
    expect(loader.formats).toEqual(['avif', 'webp', 'jpeg'])
  })

  it('returns the same object for the same input', () => {
    const url = () => ''
    expect(normalizeLoader(url)).toBe(normalizeLoader(url))
    const object = { url, widths: [1], qualities: [1], formats: 'auto' as const }
    expect(normalizeLoader(object)).toBe(normalizeLoader(object))
  })

  it('fills in the ratio ladder and keeps the rest of an object', () => {
    const object = { url: () => 'x', widths: [100], qualities: [60], formats: 'auto' as const }
    const loader = normalizeLoader(object)
    expect(loader.ratios).toEqual(DEFAULT_RATIOS)
    expect(loader.widths).toEqual([100])
    expect(loader.qualities).toEqual([60])
    expect(loader.formats).toBe('auto')
    expect(normalizeLoader({ ...object, ratios: [1] }).ratios).toEqual([1])
  })
})

describe('snapQuality', () => {
  it('returns the nearest allowed value', () => {
    expect(snapQuality(80, [75])).toBe(75)
    expect(snapQuality(62, [50, 75, 90])).toBe(50)
    expect(snapQuality(63, [50, 75, 90])).toBe(75)
    expect(snapQuality(100, [50, 75, 90])).toBe(90)
    expect(snapQuality(0, [90, 50, 75])).toBe(50)
  })

  it('sends a tie to the higher value', () => {
    expect(snapQuality(60, [50, 70])).toBe(70)
    expect(snapQuality(60, [70, 50])).toBe(70)
  })

  it('rejects an empty list', () => {
    expect(() => snapQuality(75, [])).toThrow(RangeError)
  })
})

describe('buildSrcSet', () => {
  const loader = createLoader()

  it('builds a w-descriptor srcset', () => {
    expect(
      buildSrcSet({ src: '/a.jpg', widths: [384, 640], aspectRatio: 1.5, quality: 75, format: 'webp', loader }),
    ).toBe('/_img/a.jpg?ar=1.5&fmt=webp&q=75&w=384 384w, /_img/a.jpg?ar=1.5&fmt=webp&q=75&w=640 640w')
  })

  it('passes version through', () => {
    expect(buildSrcSet({ src: '/a.jpg', widths: [64], quality: 75, format: 'avif', version: 'v2', loader })).toBe(
      '/_img/a.jpg?fmt=avif&q=75&v=v2&w=64 64w',
    )
  })

  it('is deterministic: sorted, deduplicated, same string for the same input', () => {
    const options = { src: '/a.jpg', quality: 75, format: 'webp' as const, loader }
    const sorted = buildSrcSet({ ...options, widths: [64, 128, 256] })
    expect(buildSrcSet({ ...options, widths: [256, 64, 128, 64] })).toBe(sorted)
    expect(buildSrcSet({ ...options, widths: [64, 128, 256] })).toBe(sorted)
  })

  it('works with a function loader', () => {
    const fn = normalizeLoader((r) => `/x?w=${r.width}`)
    expect(buildSrcSet({ src: '/a.jpg', widths: [100, 200], quality: 75, format: 'auto', loader: fn })).toBe(
      '/x?w=100 100w, /x?w=200 200w',
    )
  })
})
