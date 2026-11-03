import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { thumbHashToApproximateAspectRatio, thumbHashToAverageRGBA, thumbHashToRGBA } from 'thumbhash'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeMetadata, createImageApp, createMetaApp } from '../src/index.js'
import { createFixtures, solid, type Fixtures } from './fixtures.js'

let fixtures: Fixtures

beforeAll(async () => {
  fixtures = await createFixtures()
})

afterAll(() => fixtures.cleanup())

const hashBytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

describe('computeMetadata', () => {
  it.each([
    ['big.jpg', 2000, 1000],
    ['portrait.png', 600, 1200],
    ['my photos/café.jpg', 1600, 1200],
    ['small.jpg', 300, 200],
  ])('returns size, color and a ThumbHash of the right ratio for %s', async (name, width, height) => {
    const meta = await computeMetadata(path.join(fixtures.root, name))
    expect(meta).toMatchObject({ width, height })
    expect(Object.keys(meta).sort()).toEqual(['color', 'height', 'thumbhash', 'width'])
    expect(meta.thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/)

    const hash = hashBytes(meta.thumbhash)
    const ratio = width / height
    // The hash stores the ratio coarsely; the decoded image is the same shape.
    expect(thumbHashToApproximateAspectRatio(hash)).toBeCloseTo(ratio, 0)
    const decoded = thumbHashToRGBA(hash)
    expect(Math.abs(decoded.w / decoded.h - ratio) / ratio).toBeLessThan(0.15)
  })

  it('accepts a buffer', async () => {
    const buffer = await readFile(path.join(fixtures.root, 'big.jpg'))
    expect(await computeMetadata(buffer)).toEqual(await computeMetadata(path.join(fixtures.root, 'big.jpg')))
  })

  it('reports the oriented size of an EXIF-rotated image', async () => {
    const meta = await computeMetadata(path.join(fixtures.root, 'exif.jpg'))
    expect(meta).toMatchObject({ width: 200, height: 400 })
    const decoded = thumbHashToRGBA(hashBytes(meta.thumbhash))
    expect(decoded.h).toBeGreaterThan(decoded.w)
  })

  it('returns the dominant color as #rrggbb', async () => {
    const meta = await computeMetadata(await solid(300, 300, '#336699').png().toBuffer())
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/)
    const channel = (i: number) => Number.parseInt(meta.color.slice(1 + 2 * i, 3 + 2 * i), 16)
    expect(Math.abs(channel(0) - 0x33)).toBeLessThan(16)
    expect(Math.abs(channel(1) - 0x66)).toBeLessThan(16)
    expect(Math.abs(channel(2) - 0x99)).toBeLessThan(16)

    // The hash's average color agrees.
    const average = thumbHashToAverageRGBA(hashBytes(meta.thumbhash))
    expect(Math.abs(average.r * 255 - 0x33)).toBeLessThan(16)
    expect(Math.abs(average.b * 255 - 0x99)).toBeLessThan(16)
  })

  it('handles images smaller than the thumbnail', async () => {
    const meta = await computeMetadata(await solid(20, 10).png().toBuffer())
    expect(meta).toMatchObject({ width: 20, height: 10 })
    expect(thumbHashToApproximateAspectRatio(hashBytes(meta.thumbhash))).toBeGreaterThan(1)
  })

  it('reads the first frame of a GIF', async () => {
    const meta = await computeMetadata(path.join(fixtures.root, 'animated.gif'))
    expect(meta).toMatchObject({ width: 200, height: 100 })
  })
})

describe('createMetaApp', () => {
  const host = () => {
    const app = new Hono()
    app.route('/_meta', createMetaApp({ root: fixtures.root }))
    app.route('/_img', createImageApp({ root: fixtures.root }))
    return app
  }

  it('serves computeMetadata as JSON at its own mount point', async () => {
    const response = await host().request('/_meta/my%20photos/caf%C3%A9.jpg')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await response.json()).toEqual(await computeMetadata(path.join(fixtures.root, 'my photos/café.jpg')))
  })

  it('applies the same path rules', async () => {
    const app = host()
    expect((await app.request('/_meta/..%2Fsecret.jpg')).status).toBe(400)
    expect((await app.request('/_meta/icon.svg')).status).toBe(400)
    expect((await app.request('/_meta/missing.jpg')).status).toBe(404)
    expect((await app.request('/_meta/huge.png')).status).toBe(413)
  })

  it('is not part of the image app', async () => {
    const app = createImageApp({ root: fixtures.root })
    expect((await app.request('/meta?src=/big.jpg')).status).toBe(400)
    expect((await app.request('/big.jpg')).status).toBe(400)
    expect((await app.request('/placeholder?src=/big.jpg')).status).toBe(400)
  })
})
