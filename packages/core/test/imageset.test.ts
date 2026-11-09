import { describe, expect, it } from 'vitest'
import { createLoader, imageSet } from '../src/index.js'

describe('imageSet', () => {
  it('offers 1x and 2x per declared format, best format first', () => {
    const loader = createLoader({ formats: ['avif', 'webp'] })
    const url = (format: string, w: number) => `url("/_img/banner.jpg?ar=2&fmt=${format}&fx=60&fy=50&q=75&w=${w}")`
    expect(imageSet({ src: '/banner.jpg', width: 700, aspectRatio: 2, focalPoint: { x: 60, y: 50 }, loader })).toBe(
      `image-set(${url('avif', 750)} 1x type("image/avif"), ${url('avif', 1440)} 2x type("image/avif"), ` +
        `${url('webp', 750)} 1x type("image/webp"), ${url('webp', 1440)} 2x type("image/webp"))`,
    )
  })

  it('snaps ratio and quality to the ladders and drops a focus without a crop', () => {
    const loader = createLoader({ formats: ['jpeg'], qualities: [60, 80] })
    expect(imageSet({ src: '/a.jpg', width: 100, aspectRatio: 1.34, quality: 75, densities: [1], loader })).toBe(
      'image-set(url("/_img/a.jpg?ar=1.333&fmt=jpeg&q=80&w=128") 1x type("image/jpeg"))',
    )
    expect(imageSet({ src: '/a.jpg', width: 100, focalPoint: { x: 10, y: 10 }, densities: [1], loader })).toBe(
      'image-set(url("/_img/a.jpg?fmt=jpeg&q=80&w=128") 1x type("image/jpeg"))',
    )
  })

  it('leaves out a density whose URL repeats a lower one', () => {
    const loader = createLoader({ formats: ['webp'] })
    // The source is 300 px wide: both densities get the 256 px variant.
    expect(imageSet({ src: '/small.jpg', width: 200, srcWidth: 300, loader, densities: [2, 1, 3] })).toBe(
      'image-set(url("/_img/small.jpg?fmt=webp&q=75&w=256") 1x type("image/webp"))',
    )
  })

  it('passes revision and token, and writes untyped options for an auto loader', () => {
    const loader = { url: (r: { src: string; width: number; token?: string; version?: string }) => `${r.src}?w=${r.width}&t=${r.token}&v=${r.version}`, widths: [100, 200], qualities: [75], formats: 'auto' as const }
    expect(imageSet({ src: '/x', width: 90, loader, token: 'k', version: '3', densities: [1, 1.5] })).toBe('image-set(url("/x?w=100&t=k&v=3") 1x, url("/x?w=200&t=k&v=3") 1.5x)')
  })

  it('escapes what would end the CSS string', () => {
    const loader = (r: { src: string; width: number }) => `${r.src}"${r.width}`
    expect(imageSet({ src: '/a', width: 10, loader, densities: [1] })).toContain('url("/a%22')
  })
})
