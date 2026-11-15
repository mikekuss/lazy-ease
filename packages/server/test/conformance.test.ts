import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { casesOf, fixtures, type CropWindow, type StoredSource, type Topic } from '@lazy-ease/testing'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_QUALITIES, DEFAULT_RATIOS, DEFAULT_WIDTHS, formatNumber, parseImageQuery } from '../src/contract.js'
import { createImageApp, cropTokenMessage, signCropToken, verifyCropToken, type CropTokenKeys, type SourcePolicy, memoryStorage } from '../src/index.js'
import { render } from '../src/render.js'

// The portable fixtures from @lazy-ease/testing, run against the reference
// backend: the same records core runs in packages/core/test/conformance.test.ts.
// Sizes and crop windows are checked on real encoded images.

// The server implements every topic of the backend and token records.
const skipTopics: Topic[] = []
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
    expect(parseImageQuery(input.query, ladders)).toEqual({
      ...rest,
      ...(aspectRatio === null ? {} : { aspectRatio }),
      ...(focalPoint === null ? {} : { focalPoint }),
      ...(version === null ? {} : { version }),
      ...(token === null ? {} : { token }),
    })
  })
})

// Test keys by tenant and kid, from the fixture data. Public: tests only.
const testKeys = (tenant: string): CropTokenKeys =>
  Object.fromEntries(fixtures.tokens.data.keys.filter((k) => k.tenant === tenant).map((k) => [k.kid, Buffer.from(k.keyHex, 'hex')]))

describe('crop token vectors', () => {
  it.each(casesOf('tokens', 'sign'))('$id', ({ input, expected }) => {
    const { kid, ...grant } = input.grant
    const key = testKeys(grant.tenant)[kid]
    if ('error' in expected) {
      expect(() => cropTokenMessage(grant, kid)).toThrow(RangeError)
      if (key) expect(() => signCropToken(grant, kid, key)).toThrow(RangeError)
      return
    }
    expect(cropTokenMessage(grant, kid).toString('hex')).toBe(expected.messageHex)
    expect(signCropToken(grant, kid, key!)).toBe(expected.token)
  })

  it.each(casesOf('tokens', 'verify'))('$id', ({ input, expected }) => {
    expect(verifyCropToken(input.grant, input.token, testKeys(input.grant.tenant))).toBe(expected.valid)
  })

  it('checks the derivation of the public test keys', () => {
    for (const { tenant, kid, keyHex } of fixtures.tokens.data.keys) {
      expect(createHash('sha256').update(`lazy-ease public test key/${tenant}/${kid}`).digest('hex')).toBe(keyHex)
    }
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
    // The revision and focal point each source's URLs carry, as an upload record would.
    const records = new Map<string, SourcePolicy>()
    for (const c of urlCases) {
      const { pathname, searchParams } = new URL(c.expected.url, 'http://x')
      const record = records.get(pathname.slice('/_img'.length)) ?? {}
      record.revision ??= searchParams.get('v') ?? undefined
      if (searchParams.has('fx')) record.focalPoint = { x: Number(searchParams.get('fx')), y: Number(searchParams.get('fy')) }
      records.set(pathname.slice('/_img'.length), record)
    }
    for (const c of casesOf('tokens', 'verify')) files.add(decodeURIComponent(c.input.grant.source.slice(1)))
    for (const name of files) {
      const file = path.join(root, ...name.normalize('NFC').split('/'))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, await sharp({ create: { width: 800, height: 600, channels: 3, background: '#33aa77' } }).jpeg().toBuffer())
    }
    app = new Hono()
    app.route('/_img', createImageApp({ storage: memoryStorage(), root, tenant: 'demo', keys: testKeys('demo'), policy: ({ path }) => records.get(path) ?? {} }))
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

describe('crop tokens over HTTP', () => {
  // A request for the grant of a verify vector, with the raw path when it has one.
  const urlOf = ({ grant, rawPath }: { grant: { source: string; revision?: string; ar?: string; fx?: string; fy?: string }; rawPath?: string }, token: string) => {
    const query = [
      grant.ar && `ar=${grant.ar}`,
      'fmt=webp',
      grant.fx && `fx=${grant.fx}`,
      grant.fy && `fy=${grant.fy}`,
      'q=75',
      `token=${token}`,
      grant.revision && `v=${grant.revision}`,
      'w=64',
    ].filter(Boolean)
    return `/_img${rawPath ?? grant.source}?${query.join('&')}`
  }

  let root: string
  beforeAll(async () => {
    root = path.join(dir, 'token-root')
    for (const c of casesOf('tokens', 'verify')) {
      const file = path.join(root, ...decodeURIComponent(c.input.grant.source.slice(1)).split('/'))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3377aa' } }).jpeg().toBuffer())
    }
  })

  // Each vector against a token-only server of its tenant whose source has the
  // vector's revision: a malformed token is a 400, a wrong one a 403.
  it.each(casesOf('tokens', 'verify'))('$id', async ({ input, expected }) => {
    const server = new Hono()
    server.route(
      '/_img',
      createImageApp({ storage: memoryStorage(), root, tenant: input.grant.tenant, keys: testKeys(input.grant.tenant), policy: () => ({ crops: [], revision: input.grant.revision }) }),
    )
    const response = await server.request(urlOf(input, input.token))
    const wellFormed = new RegExp(fixtures.tokens.data.tokenPattern).test(input.token)
    // On a case-insensitive file system `/Cliff.jpg` and `/cliff.jpg` are one file,
    // stored under the first spelling; the other spelling is an alias and a 404.
    const name = decodeURIComponent(input.grant.source.slice(1))
    const stored = (await readdir(root)).includes(name) || name.includes('/')
    expect(response.status).toBe(!wellFormed ? 400 : !stored ? 404 : expected.valid ? 200 : 403)
  })

  it('serves the URL of sign-focal-crop', async () => {
    const server = new Hono()
    server.route('/_img', createImageApp({ storage: memoryStorage(), root, tenant: 'demo', keys: testKeys('demo'), policy: () => ({ crops: [], revision: 'r7' }) }))
    const signed = casesOf('tokens', 'sign').find((c) => c.id === 'sign-focal-crop')!
    if ('error' in signed.expected) throw new Error('sign-focal-crop is a valid record')
    const response = await server.request(signed.expected.url!)
    expect(response.status).toBe(200)
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(300)
  })
})
