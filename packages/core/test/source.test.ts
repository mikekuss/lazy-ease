import { describe, expect, it } from 'vitest'
import { isDirect, isOwned } from '../src/source.js'

describe('isOwned', () => {
  it('owns paths', () => {
    expect(isOwned('/photos/lake.jpg')).toBe(true)
    expect(isOwned('photos/lake.jpg')).toBe(true)
    expect(isOwned('./lake.jpg')).toBe(true)
    expect(isOwned('../lake.jpg')).toBe(true)
    expect(isOwned('lake.jpg')).toBe(true)
  })

  it('ignores query and hash', () => {
    expect(isOwned('/a.jpg?v=1')).toBe(true)
    expect(isOwned('/a.jpg#x')).toBe(true)
    expect(isOwned('https://cdn.example.com/a.jpg?v=1#x', ['cdn.example.com'])).toBe(true)
    expect(isOwned('https://other.site/a.jpg?host=cdn.example.com', ['cdn.example.com'])).toBe(false)
  })

  it('treats absolute URLs as external unless their host is in domains', () => {
    expect(isOwned('https://other.site/a.jpg')).toBe(false)
    expect(isOwned('https://other.site/a.jpg', ['cdn.example.com'])).toBe(false)
    expect(isOwned('https://cdn.example.com/a.jpg', ['cdn.example.com'])).toBe(true)
    expect(isOwned('http://cdn.example.com/a.jpg', ['cdn.example.com'])).toBe(true)
  })

  it('matches hosts exactly, in any case', () => {
    expect(isOwned('https://CDN.Example.com/a.jpg', ['cdn.example.com'])).toBe(true)
    expect(isOwned('https://cdn.example.com/a.jpg', ['CDN.EXAMPLE.COM'])).toBe(true)
    expect(isOwned('https://img.cdn.example.com/a.jpg', ['cdn.example.com'])).toBe(false)
    expect(isOwned('https://example.com/a.jpg', ['cdn.example.com'])).toBe(false)
    expect(isOwned('https://cdn.example.com.evil.test/a.jpg', ['cdn.example.com'])).toBe(false)
    expect(isOwned('https://cdn.example.com@evil.test/a.jpg', ['cdn.example.com'])).toBe(false)
  })

  it('requires the port when the domain entry has one', () => {
    expect(isOwned('http://localhost:3000/a.jpg', ['localhost:3000'])).toBe(true)
    expect(isOwned('http://localhost:4000/a.jpg', ['localhost:3000'])).toBe(false)
    expect(isOwned('http://localhost/a.jpg', ['localhost:3000'])).toBe(false)
    expect(isOwned('https://cdn.example.com/a.jpg', ['cdn.example.com:443'])).toBe(true)
    expect(isOwned('https://cdn.example.com:443/a.jpg', ['cdn.example.com:443'])).toBe(true)
    expect(isOwned('http://cdn.example.com/a.jpg', ['cdn.example.com:443'])).toBe(false)
    expect(isOwned('http://cdn.example.com/a.jpg', ['cdn.example.com:80'])).toBe(true)
  })

  it('accepts any port when the domain entry has none', () => {
    expect(isOwned('http://localhost:3000/a.jpg', ['localhost'])).toBe(true)
  })

  it('handles IP hosts', () => {
    expect(isOwned('http://127.0.0.1:8080/a.jpg', ['127.0.0.1:8080'])).toBe(true)
    expect(isOwned('http://[::1]:8080/a.jpg', ['[::1]:8080'])).toBe(true)
    expect(isOwned('http://[::1]:8080/a.jpg', ['[::1]'])).toBe(true)
  })

  it('treats protocol-relative URLs as external', () => {
    expect(isOwned('//cdn.example.com/a.jpg')).toBe(false)
    expect(isOwned('//cdn.example.com/a.jpg', ['cdn.example.com'])).toBe(false)
    expect(isOwned('/\\cdn.example.com/a.jpg')).toBe(false)
    expect(isOwned('\\\\cdn.example.com/a.jpg')).toBe(false)
  })

  it('treats data:, blob: and other schemes as external', () => {
    expect(isOwned('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isOwned('DATA:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isOwned('blob:https://cdn.example.com/1234', ['cdn.example.com'])).toBe(false)
    expect(isOwned('ftp://cdn.example.com/a.jpg', ['cdn.example.com'])).toBe(false)
    expect(isOwned('javascript:alert(1)')).toBe(false)
    expect(isOwned('C:/photos/a.jpg')).toBe(false)
  })

  it('treats empty and unparseable sources as external', () => {
    expect(isOwned('')).toBe(false)
    expect(isOwned('   ')).toBe(false)
    expect(isOwned('http://')).toBe(false)
    expect(isOwned('https://exa mple.com/a.jpg', ['exa mple.com'])).toBe(false)
  })

  it('ignores malformed domain entries', () => {
    expect(isOwned('https://cdn.example.com/a.jpg', ['https://cdn.example.com'])).toBe(false)
    expect(isOwned('https://cdn.example.com/a.jpg', ['cdn.example.com/path'])).toBe(false)
    expect(isOwned('https://cdn.example.com/a.jpg', [''])).toBe(false)
  })
})

describe('isOwned as in @lazy-ease/react 0.2', () => {
  it('rejects other schemes even with an explicit port, and the resolution base as a host', () => {
    expect(isOwned('ftp://img.example.com:21/a.jpg', ['img.example.com'])).toBe(false)
    expect(isOwned('ws://img.example.com:80/a.jpg', ['img.example.com'])).toBe(false)
    expect(isOwned('http://lazy-ease.invalid/x')).toBe(false)
    expect(isOwned('https://lazy-ease.invalid/x')).toBe(false)
  })

  it('reads domain entries the same way', () => {
    expect(isOwned('https://img.example.com/a.jpg', ['img.example.com/'])).toBe(true)
    expect(isOwned('https://img.example.com/a.jpg', ['img.example.com?x'])).toBe(false)
    expect(isOwned('https://img.example.com/a.jpg', ['user@img.example.com'])).toBe(false)
    expect(isOwned('http://img.example.com:8080/a.jpg', ['img.example.com:08080'])).toBe(true)
  })

  // The answers of the 0.2 React implementation, which core replaces.
  it.each<[string, string[], boolean]>([
    ['/a.jpg', [], true],
    ['a_b:c.jpg', [], true],
    ['C:/photos/a.jpg', [], false],
    ['http://lazy-ease.invalid/x', [], false],
    ['http://lazy-ease.invalid/x', ['lazy-ease.invalid'], true],
    ['ftp://img.example.com:21/a.jpg', ['img.example.com'], false],
    ['ftp://img.example.com/a.jpg', ['img.example.com:21'], false],
    ['blob:https://img.example.com/1', ['img.example.com'], false],
    ['HTTPS://IMG.example.com:443/a.jpg', ['img.example.com:443'], true],
    ['http://img.example.com/a.jpg', ['img.example.com:80'], true],
    ['http://img.example.com:81/a.jpg', ['img.example.com:80'], false],
    ['http://[::1]:8080/a.jpg', ['[::1]:8080'], true],
    ['http://img.example.com/a.jpg', ['img.example.com/'], true],
    ['http://img.example.com/a.jpg', ['img.example.com#'], true],
    ['http://img.example.com/a.jpg', ['img.example.com:'], true],
    ['http://img.example.com/a.jpg', ['img.example.com/x'], false],
    ['//img.example.com/a.jpg', ['img.example.com'], false],
    ['/\\img.example.com/a.jpg', ['img.example.com'], false],
    ['  /a.jpg  ', [], true],
    ['http://', [], false],
  ])('%s with %j', (src, domains, owned) => {
    expect(isOwned(src, domains)).toBe(owned)
  })
})

describe('isDirect', () => {
  it('sends owned raster sources through the loader', () => {
    expect(isDirect('/lake.jpg')).toBe(false)
    expect(isDirect('/lake.webp?v=2')).toBe(false)
    expect(isDirect('https://cdn.example.com/lake.png', ['cdn.example.com'])).toBe(false)
    expect(isDirect('/svg/lake.jpg')).toBe(false)
  })

  it('loads external URLs as they are', () => {
    expect(isDirect('https://images.example.org/fern.jpg')).toBe(true)
    expect(isDirect('//cdn.example.com/a.jpg')).toBe(true)
    expect(isDirect('data:image/png;base64,AAAA')).toBe(true)
  })

  it('passes SVG through by pathname extension or data MIME type', () => {
    expect(isDirect('/logo.svg')).toBe(true)
    expect(isDirect('/logo.SVG?v=3#icon')).toBe(true)
    expect(isDirect('data:image/svg+xml,%3Csvg%3E')).toBe(true)
    expect(isDirect('/logo.svg.jpg')).toBe(false)
  })

  it('passes GIF through, since it may be animated', () => {
    expect(isDirect('/wave.gif')).toBe(true)
    expect(isDirect('https://cdn.example.com/wave.Gif', ['cdn.example.com'])).toBe(true)
    expect(isDirect('data:image/gif;base64,R0lGOD')).toBe(true)
  })
})
