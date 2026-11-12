import { readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtures as vectors } from '@lazy-ease/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_QUALITIES, DEFAULT_RATIOS, DEFAULT_WIDTHS, OUTPUT_FORMATS, createImageApp, signCropToken } from '../src/index.js'
import { render, type Encoded } from '../src/render.js'
import { revisionOf } from '../src/policy.js'
import { createFixtures, type Fixtures } from './fixtures.js'

// The render step is replaced, so these tests control when native work ends.
vi.mock('../src/render.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/render.js')>()
  return { ...original, render: vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]), type: 'image/webp' })) }
})

// Reads stay real; a test can hold one back to see which reads start.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, readFile: vi.fn(original.readFile) }
})

let fixtures: Fixtures
beforeAll(async () => {
  fixtures = await createFixtures()
})
afterAll(() => fixtures.cleanup())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const encoded: Encoded = { body: new Uint8Array([9, 9]), type: 'image/webp' }

describe('the default grant', () => {
  const KEY = Buffer.from(vectors.tokens.data.keys[0]!.keyHex, 'hex')

  it('admits 39 outputs for one approved crop and nothing else', async () => {
    const app = createImageApp({ root: fixtures.root, tenant: 'demo', keys: { k1: KEY }, policy: () => ({ crops: [], revision: 'r7' }), cacheSize: 0 })
    const token = signCropToken({ tenant: 'demo', source: '/big.jpg', revision: 'r7', ar: '1', fx: '30', fy: '45' }, 'k1', KEY)
    const admitted: string[] = []
    for (const w of DEFAULT_WIDTHS) {
      for (const fmt of OUTPUT_FORMATS) {
        for (const q of DEFAULT_QUALITIES) {
          const response = await app.request(`/big.jpg?ar=1&fmt=${fmt}&fx=30&fy=45&q=${q}&token=${token}&v=r7&w=${w}`, { method: 'HEAD' })
          if (response.status === 200) admitted.push(`${fmt}/${w}/${q}`)
        }
      }
    }
    expect(admitted).toHaveLength(39)
    expect(DEFAULT_WIDTHS.length * OUTPUT_FORMATS.length * DEFAULT_QUALITIES.length).toBe(39)
    // Off-ladder values and any other crop stay out.
    for (const query of [
      'ar=1&fmt=webp&fx=30&fy=45&q=80&token=T&v=r7&w=640',
      'ar=1&fmt=webp&fx=30&fy=45&q=75&token=T&v=r7&w=641',
      'ar=1&fmt=png&fx=30&fy=45&q=75&token=T&v=r7&w=640',
      'ar=1&fmt=webp&fx=30&fy=46&q=75&token=T&v=r7&w=640',
      'ar=1.5&fmt=webp&fx=30&fy=45&q=75&token=T&v=r7&w=640',
      'ar=1&fmt=webp&q=75&token=T&v=r7&w=640',
      'fmt=webp&q=75&token=T&v=r7&w=640',
      'ar=1&fmt=webp&fx=30&fy=45&q=75&token=T&w=640',
    ]) {
      expect((await app.request(`/big.jpg?${query.replace('T', token)}`)).status, query).toBeGreaterThanOrEqual(400)
    }
  })

  it('bounds the tokenless default to uncropped plus the centered ratio ladder', async () => {
    const app = createImageApp({ root: fixtures.root, cacheSize: 0 })
    let crops = 0
    for (const ar of [undefined, ...DEFAULT_RATIOS]) {
      const query = `${ar === undefined ? '' : `ar=${ar}&`}fmt=webp&q=75&w=64`
      if ((await app.request(`/big.jpg?${query}`, { method: 'HEAD' })).status === 200) crops++
    }
    expect(crops).toBe(1 + 73)
    expect((await app.request('/big.jpg?ar=1&fmt=webp&fx=0&fy=0&q=75&w=64')).status).toBe(403)
  })
})

describe('render capacity', () => {
  it('answers 504 at the deadline, keeps the slot until the native job ends and keeps its result', async () => {
    const native = deferred<Encoded>()
    vi.mocked(render).mockClear().mockImplementationOnce(() => native.promise)
    const app = createImageApp({ root: fixtures.root, concurrency: 1, maxPending: 0, timeout: 50 })
    const url = '/big.jpg?fmt=webp&q=75&w=640'

    const started = Date.now()
    const late = await app.request(url)
    expect(late.status).toBe(504)
    expect(late.headers.get('cache-control')).toBe('no-store')
    expect(Date.now() - started).toBeLessThan(1000)

    // The render still runs: the same variant joins it instead of rendering twice,
    // and another variant finds no free slot and no room to wait.
    const joined = app.request(url)
    const busy = await app.request('/big.jpg?fmt=webp&q=75&w=1080')
    expect(busy.status).toBe(503)
    expect(busy.headers.get('retry-after')).toBe('1')
    expect(render).toHaveBeenCalledTimes(1)

    native.resolve(encoded)
    const response = await joined
    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([9, 9])
    await tick()
    // The slot is free again, and the finished work was kept.
    expect((await app.request('/big.jpg?fmt=webp&q=75&w=1080')).status).toBe(200)
    expect((await app.request(url)).status).toBe(200)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('counts queue time against the deadline and never starts an abandoned job', async () => {
    const first = deferred<Encoded>()
    vi.mocked(render).mockClear().mockImplementationOnce(() => first.promise)
    const app = createImageApp({ root: fixtures.root, concurrency: 1, maxPending: 4, timeout: 50 })
    const running = app.request('/big.jpg?fmt=webp&q=75&w=640')
    await tick()
    const queued = await app.request('/big.jpg?fmt=webp&q=75&w=1080')
    expect(queued.status).toBe(504)
    first.resolve(encoded)
    expect((await running).status).toBe(504)
    await tick()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('answers overload with 503 and Retry-After, and serves cache hits meanwhile', async () => {
    const gate = deferred<Encoded>()
    vi.mocked(render).mockClear()
    const app = createImageApp({ root: fixtures.root, concurrency: 1, maxPending: 1, timeout: 4000 })
    expect((await app.request('/small.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    vi.mocked(render).mockImplementationOnce(() => gate.promise)
    const running = app.request('/big.jpg?fmt=webp&q=75&w=64')
    await tick()
    const waiting = app.request('/big.jpg?fmt=webp&q=75&w=128')
    await tick()
    const rejected = await app.request('/big.jpg?fmt=webp&q=75&w=256')
    expect(rejected.status).toBe(503)
    expect(rejected.headers.get('retry-after')).toBe('4')
    // A warm variant needs no slot.
    expect((await app.request('/small.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    gate.resolve(encoded)
    expect([(await running).status, (await waiting).status]).toEqual([200, 200])
  })

  it('gives a render the full timeout when it starts, however late its request joined', async () => {
    const first = deferred<Encoded>()
    vi.mocked(render).mockClear().mockImplementationOnce(() => first.promise)
    const app = createImageApp({ root: fixtures.root, concurrency: 1, maxPending: 1, timeout: 3000, policy: () => ({ revision: 'r1' }) })
    const running = app.request('/big.jpg?fmt=webp&q=75&v=r1&w=640')
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const queued = app.request('/big.jpg?fmt=webp&q=75&v=r1&w=1080')
    await new Promise((resolve) => setTimeout(resolve, 300))
    first.resolve(encoded)
    expect([(await running).status, (await queued).status]).toEqual([200, 200])
    // Not the 2.7 s its request had left: the response deadline bounds the caller, not sharp.
    expect(vi.mocked(render).mock.calls.map((call) => call[2]?.timeout)).toEqual([3000, 3000])
  })

  it('bounds hashing for content revisions, so a 503 also limits disk reads', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `cold-${i}.jpg`)
    const bytes = Buffer.from('not decoded, render is mocked')
    for (const name of names) await writeFile(path.join(fixtures.root, name), bytes)
    vi.mocked(render).mockClear()
    const gate = deferred<Buffer>()
    vi.mocked(readFile).mockClear().mockImplementationOnce((() => gate.promise) as never)
    const app = createImageApp({ root: fixtures.root, concurrency: 1, maxPending: 0, timeout: 4000 })
    const first = app.request(`/${names[0]}?fmt=webp&q=75&w=64`)
    await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(1))
    // Every other cold source needs a hash too, and there is no room to start one.
    const rest = await Promise.all(names.slice(1).map((name) => app.request(`/${name}?fmt=webp&q=75&w=64`)))
    expect(rest.map((response) => response.status)).toEqual(names.slice(1).map(() => 503))
    expect(readFile).toHaveBeenCalledTimes(1)
    gate.resolve(bytes)
    expect((await first).status).toBe(200)
    // The render read the file once more and checked it against the revision.
    expect(readFile).toHaveBeenCalledTimes(2)
  })
})

describe('a source rewritten in place with the same size and mtime', () => {
  // The pass-through only checks the header, so the payload can be any bytes of one length.
  const gif = (payload: string) => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0]), Buffer.from(payload)])
  const rewrite = async (file: string, payload: string) => {
    await writeFile(file, gif(payload))
    await utimes(file, 6_000_000, 6_000_000)
  }
  const readsOf = (name: string) => vi.mocked(readFile).mock.calls.filter(([file]) => String(file).endsWith(name)).length

  it('answers every request joined to the stale job with a 503 of its own', async () => {
    const file = path.join(fixtures.root, 'joined.gif')
    await rewrite(file, 'AAAA')
    const gate = deferred<Encoded>()
    vi.mocked(render).mockClear().mockImplementationOnce(() => gate.promise)
    const app = createImageApp({
      root: fixtures.root,
      concurrency: 1,
      maxPending: 4,
      cacheSize: 0,
      policy: ({ path }) => (path === '/big.jpg' ? { revision: 'r1' } : {}),
    })
    // Memoizes the revision of the first bytes.
    expect((await app.request('/joined.gif')).status).toBe(200)
    const running = app.request('/big.jpg?fmt=webp&q=75&v=r1&w=640')
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const joined = [1, 2, 3].map(() => app.request('/joined.gif'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await rewrite(file, 'BBBB')
    gate.resolve(encoded)
    expect((await running).status).toBe(200)
    for (const response of await Promise.all(joined)) {
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('1')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).toBe('Source changed')
    }
    expect(Buffer.from(await (await app.request('/joined.gif')).arrayBuffer()).subarray(10).toString()).toBe('BBBB')
  })

  it('serves the new revision on its first request, and bounds the rehashing of random v values', async () => {
    const file = path.join(fixtures.root, 'in-place.gif')
    await rewrite(file, 'AAAA')
    const app = createImageApp({ root: fixtures.root, cacheSize: 0 })
    vi.mocked(readFile).mockClear()
    expect((await app.request(`/in-place.gif?v=${revisionOf(gif('AAAA'))}`)).status).toBe(200)
    expect(readsOf('in-place.gif')).toBe(2)

    await rewrite(file, 'BBBB')
    const next = await app.request(`/in-place.gif?v=${revisionOf(gif('BBBB'))}`)
    expect(next.status).toBe(200)
    expect(Buffer.from(await next.arrayBuffer()).subarray(10).toString()).toBe('BBBB')
    // One rehash and one render.
    expect(readsOf('in-place.gif')).toBe(4)
    // Within the cooldown, misses reuse that hash and read nothing.
    const sprayed = await Promise.all(Array.from({ length: 20 }, (_, i) => app.request(`/in-place.gif?v=random-${i}`)))
    expect(sprayed.map((response) => response.status)).toEqual(sprayed.map(() => 404))
    expect((await app.request(`/in-place.gif?v=${revisionOf(gif('AAAA'))}`)).status).toBe(404)
    expect(readsOf('in-place.gif')).toBe(4)

    // After the cooldown, concurrent misses on a stale memo join one rehash.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await rewrite(file, 'CCCC')
    const again = await Promise.all(Array.from({ length: 10 }, (_, i) => app.request(`/in-place.gif?v=again-${i}`)))
    expect(again.map((response) => response.status)).toEqual(again.map(() => 404))
    expect(readsOf('in-place.gif')).toBe(5)
    expect((await app.request('/in-place.gif?v=after-0')).status).toBe(404)
    expect(readsOf('in-place.gif')).toBe(5)
    // That rehash already picked up the new bytes.
    expect((await app.request(`/in-place.gif?v=${revisionOf(gif('CCCC'))}`)).status).toBe(200)
    expect(readsOf('in-place.gif')).toBe(6)
  })

  it('answers the previous deploy’s v with a 404 that reads nothing', async () => {
    const file = path.join(fixtures.root, 'deployed.gif')
    await rewrite(file, 'AAAA')
    const app = createImageApp({ root: fixtures.root, cacheSize: 0 })
    const old = revisionOf(gif('AAAA'))
    expect((await app.request(`/deployed.gif?v=${old}`)).status).toBe(200)
    // An atomic deploy: new bytes and a new mtime, hashed fresh once.
    await writeFile(file, gif('BBBB'))
    await utimes(file, 7_000_000, 7_000_000)
    expect((await app.request(`/deployed.gif?v=${revisionOf(gif('BBBB'))}`)).status).toBe(200)
    vi.mocked(readFile).mockClear()
    // Old pages keep asking for the old v, also across the rehash cooldown.
    for (let round = 0; round < 2; round++) {
      const stale = await Promise.all(Array.from({ length: 10 }, () => app.request(`/deployed.gif?v=${old}`)))
      expect(stale.map((response) => response.status)).toEqual(stale.map(() => 404))
      if (round === 0) await new Promise((resolve) => setTimeout(resolve, 1100))
    }
    expect(readsOf('deployed.gif')).toBe(0)
    // An unknown v still rehashes once.
    expect((await app.request('/deployed.gif?v=unknown')).status).toBe(404)
    expect(readsOf('deployed.gif')).toBe(1)
  })

  it('does not rehash for a policy revision or a freshly hashed one', async () => {
    const file = path.join(fixtures.root, 'no-rehash.gif')
    await rewrite(file, 'AAAA')
    vi.mocked(readFile).mockClear()
    const cold = createImageApp({ root: fixtures.root, cacheSize: 0 })
    expect((await cold.request('/no-rehash.gif?v=other')).status).toBe(404)
    expect(readsOf('no-rehash.gif')).toBe(1)
    const pinned = createImageApp({ root: fixtures.root, cacheSize: 0, policy: () => ({ revision: 'r1' }) })
    expect((await pinned.request('/no-rehash.gif?v=other')).status).toBe(404)
    expect(readsOf('no-rehash.gif')).toBe(1)
  })
})
