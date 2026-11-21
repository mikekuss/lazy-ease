import { describe, expect, it, vi } from 'vitest'
import { focusStyles, parsePlaceholder } from '../src/styles.js'
import { thumbhashDecoder, type ThumbHashFunctions } from '../src/thumbhash.js'

describe('parsePlaceholder', () => {
  it('reads colors, data URIs and none', () => {
    expect(parsePlaceholder('#e5e7eb')).toEqual({ style: { backgroundColor: '#e5e7eb' } })
    expect(parsePlaceholder(' rgb(1 2 3 / 50%) ')).toEqual({ style: { backgroundColor: 'rgb(1 2 3 / 50%)' } })
    expect(parsePlaceholder('none')).toEqual({ style: {} })
    expect(parsePlaceholder('data:image/png;base64,AA"A')).toEqual({
      style: { backgroundImage: 'url("data:image/png;base64,AA%22A")', backgroundSize: 'cover' },
    })
  })

  it('rejects values that could break out of the declaration', () => {
    for (const value of ['', 'red; color: blue', 'url(x)', 'red}', '"red"']) expect(parsePlaceholder(value)).toBeUndefined()
  })

  it('needs a registered decoder for ThumbHash', () => {
    expect(parsePlaceholder('thumbhash:abc')).toBeUndefined()
    const decoder = vi.fn(() => ({ style: { backgroundColor: '#000' } }))
    expect(parsePlaceholder('ThumbHash:abc', decoder)).toEqual({ style: { backgroundColor: '#000' } })
    expect(decoder).toHaveBeenCalledWith('abc')
  })
})

describe('focusStyles', () => {
  const focus = { x: 70, y: 40 }

  it('places an uncropped image with container units', () => {
    const styles = focusStyles({ focus, srcWidth: 3000, srcHeight: 2000 })
    expect(styles.box).toEqual({ containerType: 'size' })
    expect(styles.img.objectPosition).toMatch(/^clamp\(100cqw - max\(100cqw, 100cqh \* 1\.5\)/)
  })

  it('falls back to percent without the source size', () => {
    expect(focusStyles({ focus })).toEqual({ box: {}, img: { objectPosition: '70% 40%' } })
  })

  it('leaves a server crop alone without the source size', () => {
    expect(focusStyles({ focus, crop: 1 })).toEqual({ box: {}, img: {} })
  })

  it('places the rest of a server crop', () => {
    expect(focusStyles({ focus, crop: 1, srcWidth: 3000, srcHeight: 2000 }).img.objectPosition).toContain('cqw')
  })
})

describe('thumbhashDecoder', () => {
  const functions: ThumbHashFunctions = {
    thumbHashToAverageRGBA: vi.fn(() => ({ r: 1, g: 0.5, b: 0, a: 1 })),
    thumbHashToDataURL: vi.fn(() => 'data:image/png;base64,QUJD'),
  }
  // A real 6-byte header (alpha flag clear), base64.
  const hash = '1QcSHQRnh493V4dIh4eXh1h4kJUI'

  it('shows the average color and decodes the image only on demand', () => {
    const decode = thumbhashDecoder(functions)
    const placeholder = decode(hash)!
    expect(placeholder.style).toEqual({ backgroundColor: '#ff8000' })
    expect(functions.thumbHashToDataURL).not.toHaveBeenCalled()
    expect(placeholder.lazy!()).toEqual({
      backgroundColor: '#ff8000',
      backgroundImage: 'url("data:image/png;base64,QUJD")',
      backgroundSize: 'cover',
    })
    placeholder.lazy!()
    decode(hash)!.lazy!()
    expect(functions.thumbHashToDataURL).toHaveBeenCalledOnce()
  })

  it('writes a translucent average as rgba', () => {
    const decode = thumbhashDecoder({ ...functions, thumbHashToAverageRGBA: () => ({ r: 0, g: 0, b: 1, a: 0.5 }) })
    expect(decode(hash)!.style).toEqual({ backgroundColor: 'rgba(0, 0, 255, 0.5)' })
  })

  it('rejects malformed hashes', () => {
    const decode = thumbhashDecoder(functions)
    for (const bad of ['', 'not base64!', 'AAAA', '////']) expect(decode(bad)).toBeUndefined()
  })

  // A PNG data URI whose IHDR says 32 × 24; the pixels don't matter here.
  const png = (() => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 32, 0, 0, 0, 24, 8, 6, 0, 0, 0]
    return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
  })()
  const real = { ...functions, thumbHashToDataURL: () => png }
  // The same hash with the alpha flag (bit 23) set.
  const alphaHash = (() => {
    const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    bytes[2]! |= 0x80
    return btoa(String.fromCharCode(...bytes))
  })()
  const svgOf = (style: Record<string, string | undefined>) => decodeURIComponent(/^url\("data:image\/svg\+xml,(.*)"\)$/.exec(style.backgroundImage!)![1]!)

  it('draws the decoded image blurred in an SVG, opaque to its edges', () => {
    const style = thumbhashDecoder(real)(hash)!.lazy!()
    expect(style.backgroundColor).toBe('#ff8000')
    expect(style.backgroundSize).toBe('cover')
    const svg = svgOf(style)
    expect(svg).toContain("viewBox='0 0 32 24'")
    // 8 % of the longer edge.
    expect(svg).toContain("stdDeviation='2.56'")
    expect(svg).toContain("<feFuncA type='discrete' tableValues='1 1'/>")
    expect(svg).toContain(`href='${png}'`)
    // The only characters a data URI must escape are escaped.
    expect(style.backgroundImage).not.toMatch(/#/)
  })

  it('keeps the alpha of a transparent image and paints no color under it', () => {
    const decode = thumbhashDecoder({ ...real, thumbHashToAverageRGBA: () => ({ r: 0, g: 0, b: 1, a: 0.25 }) })
    const placeholder = decode(alphaHash)!
    // Before activation the translucent average stands in for the image.
    expect(placeholder.style).toEqual({ backgroundColor: 'rgba(0, 0, 255, 0.25)' })
    // It stands for a transparent image, so the controller fades it out with the fade.
    expect(placeholder.transparent).toBe(true)
    expect(thumbhashDecoder(real)(hash)!.transparent).toBe(false)
    const style = placeholder.lazy!()
    expect(style.backgroundColor).toBeUndefined()
    const svg = svgOf(style)
    expect(svg).toContain('feGaussianBlur')
    expect(svg).not.toContain('feFuncA')
  })

  it('takes the blur in percent, and paints the PNG as is for 0', () => {
    expect(svgOf(thumbhashDecoder(real, { blur: 25 })(hash)!.lazy!())).toContain("stdDeviation='8'")
    expect(thumbhashDecoder(real, { blur: 0 })(hash)!.lazy!().backgroundImage).toBe(`url("${png}")`)
    expect(thumbhashDecoder(real, { blur: 0 })(alphaHash)!.lazy!()).toEqual({ backgroundImage: `url("${png}")`, backgroundSize: 'cover' })
    for (const blur of [-1, NaN, Infinity]) expect(() => thumbhashDecoder(real, { blur })).toThrow(RangeError)
  })
})
