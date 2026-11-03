import { describe, expect, it } from 'vitest'
import { createLoader } from '../src/loader.js'
import { colorPlaceholder } from '../src/placeholder.js'
import { candidateWidths, snapWidth } from '../src/widths.js'

describe('snapWidth', () => {
  it('rounds up to the next allowed width', () => {
    expect(snapWidth(300)).toBe(384)
    expect(snapWidth(640)).toBe(640)
  })

  it('caps at the largest allowed width', () => {
    expect(snapWidth(10_000)).toBe(3840)
  })
})

describe('candidateWidths', () => {
  it('returns 1x and 2x for fixed-width images', () => {
    expect(candidateWidths(320)).toEqual([384, 640])
  })

  it('returns every width for fluid images', () => {
    expect(candidateWidths(undefined, [100, 200])).toEqual([100, 200])
  })
})

describe('createLoader', () => {
  it('builds image URLs with an explicit format', () => {
    const loader = createLoader({ baseUrl: '/img/' })
    expect(loader.url({ src: '/a b.jpg', width: 640, height: 360, format: 'webp' })).toBe(
      '/img/image?src=%2Fa+b.jpg&w=640&h=360&fmt=webp',
    )
  })

  it('appends extra params', () => {
    const loader = createLoader({ params: { v: 2 } })
    expect(loader.url({ src: '/a.jpg', width: 64 })).toBe('/_img/image?src=%2Fa.jpg&w=64&v=2')
  })
})

describe('colorPlaceholder', () => {
  it('returns an inline 1x1 svg', () => {
    const uri = colorPlaceholder('#3a7')
    expect(uri).toMatch(/^data:image\/svg\+xml,/)
    expect(decodeURIComponent(uri)).toContain('viewBox="0 0 1 1"')
    expect(decodeURIComponent(uri)).toContain('fill="#3a7"')
  })
})
