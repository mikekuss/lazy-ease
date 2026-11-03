import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash'
import { describe, expect, it } from 'vitest'
import { parsePlaceholder, thumbhashImageStyle } from '../src/placeholder.js'

function solid(r: number, g: number, b: number, a = 255): string {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, a], i)
  const hash = rgbaToThumbHash(8, 8, rgba)
  return btoa(String.fromCharCode(...hash))
}

const RED = solid(255, 0, 0)
const SEE_THROUGH = solid(0, 0, 255, 128)

describe('parsePlaceholder', () => {
  it('detects none', () => {
    expect(parsePlaceholder('none')).toEqual({ kind: 'none', ssrStyle: {} })
  })

  it('treats anything else as a color', () => {
    for (const color of ['#5b6c8f', '#abc', 'rgb(1 2 3)', 'rgba(1, 2, 3, 0.5)', 'hsl(120 50% 50%)', 'red', 'var(--ph)']) {
      expect(parsePlaceholder(color)).toEqual({ kind: 'color', ssrStyle: { backgroundColor: color } })
    }
  })

  it('trims whitespace', () => {
    expect(parsePlaceholder('  #fff ')).toEqual({ kind: 'color', ssrStyle: { backgroundColor: '#fff' } })
    expect(parsePlaceholder(' none ').kind).toBe('none')
  })

  it('renders data URIs as a covering background image', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo='
    expect(parsePlaceholder(uri)).toEqual({
      kind: 'data',
      ssrStyle: { backgroundImage: `url("${uri}")`, backgroundSize: 'cover', backgroundPosition: 'center' },
    })
    expect(parsePlaceholder('DATA:image/gif;base64,R0lGOD').kind).toBe('data')
  })

  it('escapes characters that would end the CSS string', () => {
    const svg = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg">\n</svg>`
    const { ssrStyle } = parsePlaceholder(svg)
    expect(ssrStyle.backgroundImage).toBe(
      'url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22>%0A</svg>")',
    )
  })

  it('renders only the average color of a ThumbHash on the server', () => {
    const placeholder = parsePlaceholder(`thumbhash:${RED}`)
    expect(placeholder.kind).toBe('thumbhash')
    expect(placeholder.ssrStyle).toEqual({ backgroundColor: expect.stringMatching(/^#[0-9a-f]{6}$/) })
    // Quantized, but clearly red.
    const hex = placeholder.ssrStyle.backgroundColor!
    expect(parseInt(hex.slice(1, 3), 16)).toBeGreaterThan(200)
    expect(parseInt(hex.slice(3, 5), 16)).toBeLessThan(60)
  })

  it('uses rgba() for a translucent ThumbHash', () => {
    const { ssrStyle } = parsePlaceholder(`thumbhash:${SEE_THROUGH}`)
    expect(ssrStyle.backgroundColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d{1,3}\)$/)
  })

  it('decodes a ThumbHash on the client, memoized per hash', () => {
    const placeholder = parsePlaceholder(`thumbhash:${RED}`)
    if (placeholder.kind !== 'thumbhash') throw new Error('expected a thumbhash')
    const style = placeholder.clientStyle()
    const bytes = Uint8Array.from(atob(RED), (c) => c.charCodeAt(0))
    expect(style).toEqual({
      backgroundColor: placeholder.ssrStyle.backgroundColor,
      backgroundImage: `url("${thumbHashToDataURL(bytes)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    })
    expect(style.backgroundImage).toMatch(/^url\("data:image\/png;base64,/)
    expect(placeholder.clientStyle()).toBe(style)
    const again = parsePlaceholder(`thumbhash:${RED}`)
    if (again.kind !== 'thumbhash') throw new Error('expected a thumbhash')
    expect(again.clientStyle()).toBe(style)
  })

  it('accepts base64url ThumbHashes and a prefix in any case', () => {
    const url = RED.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(parsePlaceholder(`thumbhash:${url}`).ssrStyle).toEqual(parsePlaceholder(`thumbhash:${RED}`).ssrStyle)
    expect(parsePlaceholder(`ThumbHash:${RED}`).kind).toBe('thumbhash')
  })

  it('reports malformed placeholders as invalid instead of throwing', () => {
    const cases = [
      '',
      '   ',
      'thumbhash:',
      'thumbhash:not base64!',
      'thumbhash:AAAA', // 3 bytes, shorter than the header
      'thumbhash:////', // valid base64, still too short
      'thumbhash:AAAAAA=====', // too much padding
      'red; background-image: url(https://evil.test/x)',
      'url(https://evil.test/x)',
      'red"><script>',
      '}body{display:none',
    ]
    for (const value of cases) {
      const placeholder = parsePlaceholder(value)
      expect(placeholder.kind, value).toBe('invalid')
      expect(placeholder.ssrStyle).toEqual({})
    }
  })

  it('checks the alpha byte of a ThumbHash', () => {
    // Header bit 23 set means a 6th byte carries the alpha.
    const five = btoa(String.fromCharCode(0, 0, 0x80, 0, 0))
    const six = btoa(String.fromCharCode(0, 0, 0x80, 0, 0, 0x0f))
    expect(parsePlaceholder(`thumbhash:${five}`).kind).toBe('invalid')
    expect(parsePlaceholder(`thumbhash:${six}`).kind).toBe('thumbhash')
  })
})

describe('thumbhashImageStyle', () => {
  it('returns the decoded image style for the server path', () => {
    const placeholder = parsePlaceholder(`thumbhash:${RED}`)
    if (placeholder.kind !== 'thumbhash') throw new Error('expected a thumbhash')
    expect(thumbhashImageStyle(RED)).toBe(placeholder.clientStyle())
  })

  it('decodes without a DOM', () => {
    expect(typeof document).toBe('undefined')
    expect(thumbhashImageStyle(SEE_THROUGH).backgroundImage).toMatch(/^url\("data:image\/png;base64,/)
  })

  it('throws on a malformed hash', () => {
    expect(() => thumbhashImageStyle('!!')).toThrow(TypeError)
    expect(() => thumbhashImageStyle('')).toThrow(TypeError)
  })
})
