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
})
