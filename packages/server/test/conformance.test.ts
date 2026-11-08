import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { casesOf, fixtures, skippedCases, type CropWindow, type StoredSource, type Topic } from '@lazy-ease/testing'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_QUALITIES, DEFAULT_RATIOS, DEFAULT_WIDTHS, formatNumber, parseImageQuery } from '../src/contract.js'
import { createImageApp } from '../src/index.js'
import { render } from '../src/render.js'

// The portable fixtures from @lazy-ease/testing, run against the reference
// backend: the same records core runs in packages/core/test/conformance.test.ts.
// Sizes and crop windows are checked on real encoded images.

// Topics the server does not implement yet. Their cases are checked to still
// fail below, so implementing one makes that test fail until it moves here.
const PENDING: Topic[] = [
  'strict-q', // a missing q still falls back to the first quality; the backend admission step of 0.3 rejects it (breaking against 0.2)
  'token', // crop tokens arrive in step 07
]
const skipTopics = PENDING
const ladders = { widths: DEFAULT_WIDTHS, ratios: DEFAULT_RATIOS, qualities: DEFAULT_QUALITIES }

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lazy-ease-conformance-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

const status = (run: () => unknown) => {
  try {
    run()
    return 200
  } catch (error) {
    if (error instanceof HTTPException) return error.status
    throw error
  }
}

describe('query admission', () => {
  it.each(casesOf('backend', 'query', { skipTopics }))('$id', ({ input, expected }) => {
    if (expected.status !== 200) {
      expect(status(() => parseImageQuery(input.query, ladders))).toBe(expected.status)
      return
    }
    const { aspectRatio, focalPoint, version, token, ...rest } = expected.params
    expect(token).toBeNull()
    expect(parseImageQuery(input.query, ladders)).toEqual({
      ...rest,
      ...(aspectRatio === null ? {} : { aspectRatio }),
      ...(focalPoint === null ? {} : { focalPoint }),
      ...(version === null ? {} : { version }),
    })
  })

  it('still fails the pending topics', () => {
    const pending = skippedCases('backend', 'query', { skipTopics })
    expect(pending.map((c) => c.id).sort()).toEqual([
      'query-token',
      'reject-missing-q',
      'reject-token-padding',
      'reject-token-shape',
    ])
    // A missing q is admitted and a token is an unknown parameter.
    expect(status(() => parseImageQuery('fmt=webp&w=640', ladders))).toBe(200)
    const token = pending.find((c) => c.id === 'query-token')!
    expect(status(() => parseImageQuery(token.input.query, ladders))).toBe(400)
  })
})

/** Writes `width × height` oriented pixels as a JPEG stored with `stored.orientation`, or a PNG. */
async function writeSource(file: string, pixels: Buffer, width: number, height: number, stored?: StoredSource) {
  const image = sharp(pixels, { raw: { width, height, channels: 3 } })
  if (!stored || stored.orientation === 1) {
    await writeFile(file, await image.png().toBuffer())
    return
  }
  // Store the inverse rotation, so the decoder's auto-orientation restores `pixels`.
  const inverse: Record<number, number> = { 3: 180, 6: 270, 8: 90 }
  const angle = inverse[stored.orientation]
  if (angle === undefined) throw new Error(`No fixture source for orientation ${stored.orientation}`)
  const rotated = await image.rotate(angle).png().toBuffer()
  expect(await sharp(rotated).metadata()).toMatchObject({ width: stored.width, height: stored.height })
  await writeFile(file, await sharp(rotated).withMetadata({ orientation: stored.orientation }).jpeg({ quality: 95 }).toBuffer())
}

const QUADRANTS = [
  [220, 30, 30],
  [30, 30, 220],
  [30, 200, 30],
  [230, 230, 40],
] as const
const quadrant = (x: number, y: number, width: number, height: number) =>
  (x < width / 2 ? 0 : 1) + (y < height / 2 ? 0 : 2)

/** Four flat quadrants, so a sample shows which part of the source it came from. */
function quadrants(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(QUADRANTS[quadrant(x, y, width, height)]!, (y * width + x) * 3)
  }
  return pixels
}

describe('encoded sizes', () => {
  const cases = casesOf('outputs', 'outputSize').flatMap((c) => ('error' in c.expected ? [] : [{ ...c, expected: c.expected }]))

  it.each(cases)('$id', async ({ id, input, expected }) => {
    const file = path.join(dir, `output-${id}${input.stored && input.stored.orientation !== 1 ? '.jpg' : '.png'}`)
    await writeSource(file, Buffer.alloc(input.srcWidth * input.srcHeight * 3, 128), input.srcWidth, input.srcHeight, input.stored)
    const encoded = await render(file, {
      width: input.width,
      aspectRatio: input.aspectRatio,
      focalPoint: input.focalPoint,
      quality: 75,
      format: 'webp',
    })
    const meta = await sharp(encoded.body).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual({ width: expected.width, height: expected.height })
  })

  it('includes the target height that rounds to 0', () => {
    expect(cases.find((c) => c.id === 'height-rounds-to-zero-wide')?.expected).toEqual({ requestWidth: 10, width: 10, height: 5 })
  })
})

describe('crop windows on encoded pixels', () => {
  // A grid of samples over the output must show the quadrant of the source
  // point the expected window maps each one to. Points within a few
  // pixels of a quadrant edge are skipped: resampling blurs them.
  const cases = casesOf('crops', 'cropWindow').filter((c) => c.expected.width >= 16 && c.expected.height >= 16)

  it('covers every orientation in the fixtures', () => {
    expect(new Set(cases.flatMap((c) => (c.input.stored ? [c.input.stored.orientation] : [])))).toEqual(new Set([3, 6, 8]))
  })

  it.each(cases)('$id', async ({ id, input, expected }) => {
    const { srcWidth: width, srcHeight: height } = input
    const file = path.join(dir, `crop-${id}${input.stored ? '.jpg' : '.png'}`)
    await writeSource(file, quadrants(width, height), width, height, input.stored)
    const encoded = await render(file, {
      width: expected.width,
      aspectRatio: input.aspectRatio,
      focalPoint: input.focalPoint,
      quality: 90,
      format: 'webp',
    })
    const { data, info } = await sharp(encoded.body).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let checked = 0
    const grid = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]
    for (const fu of grid) {
      for (const fv of grid) {
        const [x, y] = mapToSource(expected, fu, fv)
        if (Math.abs(x - width / 2) < 4 || Math.abs(y - height / 2) < 4) continue
        const u = Math.floor(fu * info.width)
        const v = Math.floor(fv * info.height)
        const pixel = [...data.subarray((v * info.width + u) * 3, (v * info.width + u) * 3 + 3)]
        expect(nearest(pixel), `${id} sample ${fu},${fv}`).toBe(quadrant(x, y, width, height))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

function mapToSource(window: CropWindow, fu: number, fv: number): [number, number] {
  return [window.left + fu * window.width, window.top + fv * window.height]
}

function nearest(pixel: number[]): number {
  const distance = (color: readonly number[]) => color.reduce((sum, c, i) => sum + (c - pixel[i]!) ** 2, 0)
  return QUADRANTS.reduce((best, color, i) => (distance(color) < distance(QUADRANTS[best]!) ? i : best), 0)
}

describe('loader URLs and source paths over HTTP', () => {
  let app: Hono
  // URL records the loader writes a URL for, against the default mount.
  const urlCases = casesOf('urls', 'url', { skipTopics }).flatMap((c) =>
    'url' in c.expected && c.input.baseUrl === undefined ? [{ ...c, expected: c.expected }] : [],
  )

  // Every source path the URL and path records name, as a file under the root.
  beforeAll(async () => {
    const root = path.join(dir, 'root')
    const files = new Set<string>()
    for (const c of urlCases) files.add(decodeURIComponent(new URL(c.expected.url, 'http://x').pathname.slice('/_img/'.length)))
    for (const c of casesOf('backend', 'path')) if (c.expected.status === 200) files.add(c.expected.file)
    for (const name of files) {
      const file = path.join(root, ...name.normalize('NFC').split('/'))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, await sharp({ create: { width: 800, height: 600, channels: 3, background: '#33aa77' } }).jpeg().toBuffer())
    }
    await writeFile(path.join(root, 'notes.txt'), 'hello')
    await writeFile(path.join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    app = new Hono()
    app.route('/_img', createImageApp({ root }))
  })

  it.each(urlCases)('$id', async ({ input, expected }) => {
    const { pathname, search } = new URL(expected.url, 'http://x')
    // The loader's query parses back to the request it was written from, with
    // the ratio in its canonical spelling.
    const { src: _src, aspectRatio, ...request } = input.request
    expect(parseImageQuery(search.slice(1), ladders)).toEqual({
      ...request,
      ...(aspectRatio === undefined ? {} : { aspectRatio: Number(formatNumber(aspectRatio)) }),
    })
    expect(pathname.startsWith('/_img/')).toBe(true)
    const response = await app.request(expected.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(`image/${input.request.format}`)
  })

  it.each(casesOf('backend', 'path'))('$id', async ({ input, expected }) => {
    const query = '?fmt=webp&q=75&w=64'
    const response = await app.request(`/_img${input.rawPath}${query}`)
    expect(response.status).toBe(expected.status)
    if (expected.status !== 200) return
    expect(expected.canonicalPath).toMatch(/^\//)
    // A non-canonical spelling must be the same variant as the canonical one, never a cache entry of its own.
    const canonical = await app.request(`/_img${expected.canonicalPath}${query}`)
    expect(canonical.status).toBe(200)
    expect(response.headers.get('etag')).toBe(canonical.headers.get('etag'))
  })
})
