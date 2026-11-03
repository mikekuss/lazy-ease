import { describe, expect, it } from 'vitest'
import { isOwned } from '../src/owned.js'

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
