import { symlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createImageApp } from '../src/index.js'
import { createFixtures, decode, solid, split, type Fixtures } from './fixtures.js'

let fixtures: Fixtures
let app: ReturnType<typeof createImageApp>

beforeAll(async () => {
  fixtures = await createFixtures()
  app = createImageApp({ root: fixtures.root })
})

afterAll(() => fixtures.cleanup())

/** Mounted the way the docs say, so paths look exactly like the client's URLs. */
function mounted(options: Partial<Parameters<typeof createImageApp>[0]> = {}) {
  return createImageApp({ root: fixtures.root, ...options })
}

const get = (url: string, init?: RequestInit) => app.request(url, init)

describe('client-format URLs', () => {
  // Built by hand exactly as `createLoader()` in packages/react/src/loader.ts writes them.
  it.each([
    ['/my%20photos/caf%C3%A9.jpg?ar=1.333&fmt=webp&q=75&v=AbC123&w=640', 640, 480, 'webp'],
    ['/my%20photos/caf%C3%A9.jpg?fmt=avif&q=75&w=1080', 1080, 810, 'heif'],
    ['/big.jpg?ar=1&fmt=jpeg&q=75&w=384', 384, 384, 'jpeg'],
    ['/big.jpg?ar=0.563&fmt=webp&q=75&v=1730000000000&w=256', 256, 455, 'webp'],
    ['/portrait.png?ar=1.778&fmt=webp&q=75&w=128', 128, 72, 'webp'],
  ])('serves %s', async (url, width, height, format) => {
    const response = await get(url)
    expect(response.status).toBe(200)
    expect((await decode(response)).meta).toMatchObject({ width, height, format })
  })

  it('works behind a mount point', async () => {
    const host = new Hono()
    host.route('/_img', mounted())
    const response = await host.request('/_img/my%20photos/caf%C3%A9.jpg?ar=1.333&fmt=webp&q=75&v=AbC123&w=640')
    expect(response.status).toBe(200)
    expect((await host.request('/my%20photos/caf%C3%A9.jpg?fmt=webp&w=640')).status).toBe(404)
  })

  it('finds an NFC file from an NFD path', async () => {
    expect((await get('/my%20photos/cafe%CC%81.jpg?fmt=webp&w=64')).status).toBe(200)
  })
})

describe('rendering', () => {
  it('crops to w × round(w / ar) around the center', async () => {
    for (const [ar, height] of [
      [1, 640],
      [1.5, 427],
      [2.333, 274],
    ] as const) {
      const { meta } = await decode(await get(`/big.jpg?ar=${ar}&fmt=jpeg&w=640`))
      expect([meta.width, meta.height], `ar=${ar}`).toEqual([640, height])
    }
  })

  it('crops centered', async () => {
    // A 400×100 crop from the middle of a red|blue split is half red, half blue.
    await writeFile(path.join(fixtures.root, 'split.png'), await (await split(800, 800)).png().toBuffer())
    const { buffer } = await decode(await get('/split.png?ar=4&fmt=webp&w=384'))
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number) => data.subarray((Math.floor(info.height / 2) * info.width + x) * info.channels)
    expect(pixel(10)[0]).toBeGreaterThan(200)
    expect(pixel(info.width - 10)[2]).toBeGreaterThan(200)
  })

  it('scales without a crop when ar is absent', async () => {
    const { meta } = await decode(await get('/big.jpg?fmt=webp&w=640'))
    expect([meta.width, meta.height]).toEqual([640, 320])
  })

  it('never upscales, without a crop', async () => {
    const { meta } = await decode(await get('/small.jpg?fmt=webp&w=1080'))
    expect([meta.width, meta.height]).toEqual([300, 200])
  })

  it('never upscales and keeps the requested ratio', async () => {
    // 1080×1080 does not fit a 300×200 source; the box shrinks to 200×200.
    const square = await decode(await get('/small.jpg?ar=1&fmt=webp&w=1080'))
    expect([square.meta.width, square.meta.height]).toEqual([200, 200])
    // 640×160 shrinks by width: 300×75.
    const wide = await decode(await get('/small.jpg?ar=4&fmt=webp&w=640'))
    expect([wide.meta.width, wide.meta.height]).toEqual([300, 75])
  })

  it('returns the source size when it equals the target', async () => {
    const { meta } = await decode(await get('/portrait.png?ar=0.5&fmt=webp&w=640'))
    expect([meta.width, meta.height]).toEqual([600, 1200])
  })

  it.each([
    ['/photo.webp', 'webp'],
    ['/photo.avif', 'jpeg'],
    ['/UPPER.JPG', 'avif'],
  ])('reads %s and writes %s', async (src, fmt) => {
    const response = await get(`${src}?fmt=${fmt}&w=64`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(`image/${fmt}`)
  })

  it('auto-orients, converts to sRGB and strips all metadata', async () => {
    const source = await sharp(path.join(fixtures.root, 'exif.jpg')).metadata()
    // The fixture really carries what must be stripped.
    expect(source).toMatchObject({ orientation: 6, width: 400, height: 200 })
    expect(source.exif).toBeDefined()
    expect(source.xmp).toBeDefined()
    expect(source.icc).toBeDefined()

    for (const fmt of ['jpeg', 'webp', 'avif']) {
      const response = await get(`/exif.jpg?fmt=${fmt}&w=128`)
      const { buffer, meta } = await decode(response)
      expect([meta.width, meta.height], fmt).toEqual([128, 256])
      expect(meta.orientation, fmt).toBeUndefined()
      expect(meta.exif, fmt).toBeUndefined()
      expect(meta.xmp, fmt).toBeUndefined()
      expect(meta.iptc, fmt).toBeUndefined()
      expect(meta.icc, fmt).toBeUndefined()
      expect(meta.space, fmt).toBe('srgb')
      const bytes = buffer.toString('latin1')
      expect(bytes).not.toContain('secret')
      expect(bytes).not.toContain('Exif')

      // Stored red|blue rotated 90° clockwise: red on top, blue at the bottom.
      const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
      const top = data.subarray((10 * info.width + 64) * info.channels)
      const bottom = data.subarray(((info.height - 10) * info.width + 64) * info.channels)
      expect(top[0], fmt).toBeGreaterThan(200)
      expect(bottom[2], fmt).toBeGreaterThan(200)
    }
  })

  it('crops after orienting', async () => {
    const { meta } = await decode(await get('/exif.jpg?ar=0.5&fmt=webp&w=128'))
    expect([meta.width, meta.height]).toEqual([128, 256])
  })

  it('renders the first frame of a GIF only', async () => {
    const source = await sharp(path.join(fixtures.root, 'animated.gif'), { animated: true }).metadata()
    expect(source.pages).toBe(2)
    const { buffer, meta } = await decode(await get('/animated.gif?fmt=webp&w=128'))
    expect(meta.pages ?? 1).toBe(1)
    expect([meta.width, meta.height]).toEqual([128, 64])
    const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(200) // red, the first frame
    expect(data[2]).toBeLessThan(60)
  })
})

describe('validation through the route', () => {
  it.each([
    '/big.jpg',
    '/big.jpg?w=640',
    '/big.jpg?w=640&fmt=webp',
    '/big.jpg?fmt=webp&w=640&w=640',
    '/big.jpg?fmt=webp&w=0640',
    '/big.jpg?ar=1.50&fmt=webp&w=640',
    '/big.jpg?fmt=webp&w=500',
    '/big.jpg?fmt=auto&w=640',
    '/big.jpg?fmt=webp&q=80&w=640',
    '/big.jpg?fmt=webp&run=1&w=640',
    '/big.jpg?fmt=webp&h=480&w=640',
  ])('400 for %s', async (url) => {
    expect((await get(url)).status).toBe(400)
  })

  it('honors custom qualities', async () => {
    const custom = mounted({ qualities: [50, 90] })
    expect((await custom.request('/big.jpg?fmt=webp&q=90&w=64')).status).toBe(200)
    expect((await custom.request('/big.jpg?fmt=webp&q=75&w=64')).status).toBe(400)
  })
})

describe('path safety', () => {
  it.each([
    // backslashes, drive letters, UNC, schemes, streams
    ['/a%5Cbig.jpg', 400],
    ['/..%5C..%5Csecret.jpg', 400],
    ['/C:%5Cwindows%5Cx.jpg', 400],
    ['/C:/x.jpg', 400],
    ['/c%3A/x.jpg', 400],
    ['//server/share/x.jpg', 400],
    ['/%2F%2Fserver/share/x.jpg', 400],
    ['/https:/example.com/a.jpg', 400],
    ['/big.jpg:stream.jpg', 400],
    // traversal that survives URL parsing
    ['/..%2Fsecret.jpg', 400],
    ['/my%20photos%2F..%2F..%2Fsecret.jpg', 400],
    ['/%2E%2E%2Fsecret.jpg', 400],
    // null byte
    ['/big%00.jpg', 400],
    // extensions
    ['/icon.svg', 400],
    ['/scan.tiff', 400],
    ['/scan.tif', 400],
    ['/notes.txt', 400],
    ['/big', 400],
    ['/big.jpg.svg', 400],
    // missing or outside the root
    ['/missing.jpg', 404],
    ['/my%20photos', 400],
    ['/my%20photos/missing.jpg', 404],
    ['/../secret.jpg', 404],
    ['/%2e%2e/secret.jpg', 404],
  ])('%s → %i', async (src, status) => {
    expect((await get(`${src}?fmt=webp&w=64`)).status).toBe(status)
  })

  it('does not follow symlinks out of the root', async (context) => {
    try {
      await symlink(path.join(fixtures.dir, 'secret.jpg'), path.join(fixtures.root, 'link.jpg'))
    } catch {
      // Windows needs developer mode or admin rights for symlinks.
      context.skip()
    }
    expect((await get('/link.jpg?fmt=webp&w=64')).status).toBe(404)
  })

  it('rejects a symlink named like an image that points at an SVG', async (context) => {
    try {
      await symlink(path.join(fixtures.root, 'icon.svg'), path.join(fixtures.root, 'icon-link.jpg'))
    } catch {
      context.skip()
    }
    expect((await get('/icon-link.jpg?fmt=webp&w=64')).status).toBe(400)
  })
})

describe('headers', () => {
  it('sets the caching and content headers', async () => {
    const response = await get('/big.jpg?fmt=webp&w=640')
    const body = await response.arrayBuffer()
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('content-length')).toBe(String(body.byteLength))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('etag')).toMatch(/^"[\w-]+"$/)
    expect(response.headers.get('vary')).toBeNull()
  })

  it('ignores Accept', async () => {
    const response = await get('/big.jpg?fmt=jpeg&w=64', { headers: { accept: 'image/avif,image/webp' } })
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('vary')).toBeNull()
  })

  it('answers If-None-Match with a 304', async () => {
    const etag = (await get('/big.jpg?fmt=webp&w=128')).headers.get('etag')!
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const response = await get('/big.jpg?fmt=webp&w=128', { headers: { 'if-none-match': header } })
      expect(response.status, header).toBe(304)
      expect(response.headers.get('etag')).toBe(etag)
      expect(await response.text()).toBe('')
    }
    const miss = await get('/big.jpg?fmt=webp&w=128', { headers: { 'if-none-match': '"other"' } })
    expect(miss.status).toBe(200)
  })

  it('gives every variant its own ETag, independent of v', async () => {
    const etag = async (url: string) => (await get(url)).headers.get('etag')
    const base = await etag('/big.jpg?fmt=webp&w=128')
    expect(await etag('/big.jpg?fmt=webp&w=256')).not.toBe(base)
    expect(await etag('/big.jpg?fmt=jpeg&w=128')).not.toBe(base)
    expect(await etag('/big.jpg?ar=1&fmt=webp&w=128')).not.toBe(base)
    expect(await etag('/small.jpg?fmt=webp&w=128')).not.toBe(base)
    expect(await etag('/big.jpg?fmt=webp&q=75&w=128')).toBe(base)
    expect(await etag('/big.jpg?fmt=webp&v=abc&w=128')).toBe(base)
  })

  it('changes the ETag and the bytes when the source changes', async () => {
    const file = path.join(fixtures.root, 'changing.jpg')
    await writeFile(file, await solid(200, 200, '#000000').jpeg().toBuffer())
    await utimes(file, 1_000_000, 1_000_000)
    const first = await get('/changing.jpg?fmt=jpeg&w=64')
    await writeFile(file, await solid(200, 200, '#ffffff').jpeg().toBuffer())
    await utimes(file, 2_000_000, 2_000_000)
    const second = await get('/changing.jpg?fmt=jpeg&w=64')
    expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'))
    const pixel = async (response: Response) =>
      (await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer())[0]
    expect(await pixel(first)).toBeLessThan(30)
    expect(await pixel(second)).toBeGreaterThan(225)
  })

  it('supports HEAD with the same headers and no body', async () => {
    const full = await get('/big.jpg?fmt=avif&w=256')
    const head = await get('/big.jpg?fmt=avif&w=256', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    for (const name of ['content-type', 'content-length', 'etag', 'cache-control', 'x-content-type-options']) {
      expect(head.headers.get(name), name).toBe(full.headers.get(name))
    }
    expect((await get('/big.jpg?fmt=avif&w=500', { method: 'HEAD' })).status).toBe(400)
  })
})

describe('limits', () => {
  it('413 for a file over the size cap, before decoding', async () => {
    const capped = mounted({ maxFileSize: 100 })
    expect((await capped.request('/big.jpg?fmt=webp&w=64')).status).toBe(413)
    // broken.jpg is 12 bytes: under the cap, so it reaches the decoder and fails there instead.
    expect((await capped.request('/broken.jpg?fmt=webp&w=64')).status).toBe(500)
  })

  it('defaults the size cap to 32 MB', async () => {
    expect((await get('/big.jpg?fmt=webp&w=64')).status).toBe(200)
  })

  it('413 for a source over 50 MP', async () => {
    // huge.png claims 10000×6000 = 60 MP in its header.
    expect((await get('/huge.png?fmt=webp&w=64')).status).toBe(413)
  })

  it('honors a custom pixel limit', async () => {
    const capped = mounted({ maxInputPixels: 1_000_000 })
    expect((await capped.request('/big.jpg?fmt=webp&w=64')).status).toBe(413)
    expect((await capped.request('/small.jpg?fmt=webp&w=64')).status).toBe(200)
  })

  it('fails on corrupt input instead of rendering garbage', async () => {
    expect((await get('/broken.jpg?fmt=webp&w=64')).status).toBe(500)
  })

  it('passes the timeout to sharp in whole seconds', async () => {
    const timeout = vi.spyOn(sharp.prototype, 'timeout')
    try {
      expect((await mounted({ timeout: 1500, cacheSize: 0 }).request('/big.jpg?fmt=webp&w=64')).status).toBe(200)
      expect(timeout).toHaveBeenCalledWith({ seconds: 2 })
      expect((await mounted({ cacheSize: 0 }).request('/big.jpg?fmt=webp&w=64')).status).toBe(200)
      expect(timeout).toHaveBeenLastCalledWith({ seconds: 10 })
    } finally {
      timeout.mockRestore()
    }
  })

  it('504 when sharp reports a timeout', async () => {
    // What sharp rejects with once the pipeline runs past `timeout` seconds.
    // No real render is reliably slow enough: the AVIF encoder is not interrupted.
    const toBuffer = vi.spyOn(sharp.prototype, 'toBuffer').mockRejectedValue(new Error('timeout: 42% complete'))
    try {
      expect((await mounted({ cacheSize: 0 }).request('/big.jpg?fmt=avif&w=1920')).status).toBe(504)
    } finally {
      toBuffer.mockRestore()
    }
  })

  it('passes avifEffort to the AVIF encoder, default 4', async () => {
    const avif = vi.spyOn(sharp.prototype, 'avif')
    try {
      await mounted({ cacheSize: 0 }).request('/small.jpg?fmt=avif&w=64')
      expect(avif).toHaveBeenLastCalledWith({ quality: 75, effort: 4 })
      await mounted({ cacheSize: 0, avifEffort: 0 }).request('/small.jpg?fmt=avif&w=64')
      expect(avif).toHaveBeenLastCalledWith({ quality: 75, effort: 0 })
    } finally {
      avif.mockRestore()
    }
  })

  it('serves concurrent requests for one variant', async () => {
    const coalescing = mounted({ cacheSize: 0, concurrency: 1 })
    const url = '/my%20photos/caf%C3%A9.jpg?ar=1&fmt=avif&w=1200'
    const responses = await Promise.all([0, 1, 2, 3, 4].map(() => coalescing.request(url)))
    const bodies = await Promise.all(responses.map(async (r) => Buffer.from(await r.arrayBuffer())))
    for (const response of responses) expect(response.status).toBe(200)
    for (const body of bodies) expect(body.equals(bodies[0]!)).toBe(true)
  })

  it('renders other keys under a concurrency of 1', async () => {
    const serial = mounted({ cacheSize: 0, concurrency: 1 })
    const responses = await Promise.all(
      [64, 128, 256].map((w) => serial.request(`/big.jpg?fmt=webp&w=${w}`)),
    )
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
  })

  it('serves repeat requests from the LRU', async () => {
    const cached = mounted({ cacheSize: 1 })
    const a = await (await cached.request('/big.jpg?fmt=webp&w=750')).arrayBuffer()
    const b = await (await cached.request('/big.jpg?fmt=webp&w=750')).arrayBuffer()
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('bounds the LRU by bytes, evicting the oldest entries', async () => {
    const A = '/big.jpg?fmt=webp&w=640'
    const B = '/big.jpg?fmt=webp&w=1080'
    const size = async (url: string) => (await (await get(url)).arrayBuffer()).byteLength
    const [a, b] = [await size(A), await size(B)]
    const toBuffer = vi.spyOn(sharp.prototype, 'toBuffer')
    try {
      // Room for one of the two only.
      const cached = mounted({ cacheBytes: a + b - 1 })
      await cached.request(A)
      await cached.request(B)
      expect(toBuffer).toHaveBeenCalledTimes(2)
      await cached.request(B)
      expect(toBuffer).toHaveBeenCalledTimes(2)
      await cached.request(A)
      expect(toBuffer).toHaveBeenCalledTimes(3)

      // An entry larger than the whole budget is never kept.
      const tiny = mounted({ cacheBytes: Math.min(a, b) - 1 })
      await tiny.request(A)
      await tiny.request(A)
      expect(toBuffer).toHaveBeenCalledTimes(5)
    } finally {
      toBuffer.mockRestore()
    }
  })
})
