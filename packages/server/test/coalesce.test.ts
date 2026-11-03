import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createImageApp } from '../src/index.js'
import { render } from '../src/render.js'
import { createFixtures, type Fixtures } from './fixtures.js'

// Count real renders through the app.
vi.mock('../src/render.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/render.js')>()
  return { ...original, render: vi.fn(original.render) }
})

let fixtures: Fixtures

beforeAll(async () => {
  fixtures = await createFixtures()
})

afterAll(() => fixtures.cleanup())

describe('render coalescing', () => {
  it('renders a variant once for concurrent requests', async () => {
    vi.mocked(render).mockClear()
    const app = createImageApp({ root: fixtures.root, cacheSize: 0 })
    const url = '/big.jpg?ar=1&fmt=avif&w=1200'
    const responses = await Promise.all([0, 1, 2, 3, 4].map(() => app.request(url)))
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(render).toHaveBeenCalledTimes(1)

    // Once settled, a new request renders again (the cache is off).
    expect((await app.request(url)).status).toBe(200)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('renders different variants separately', async () => {
    vi.mocked(render).mockClear()
    const app = createImageApp({ root: fixtures.root, cacheSize: 0 })
    await Promise.all(['fmt=webp&w=64', 'fmt=webp&w=128', 'fmt=jpeg&w=64'].map((q) => app.request(`/big.jpg?${q}`)))
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('does not render for a cache hit or a 304', async () => {
    const app = createImageApp({ root: fixtures.root })
    const first = await app.request('/big.jpg?fmt=webp&w=384')
    vi.mocked(render).mockClear()
    await app.request('/big.jpg?fmt=webp&w=384')
    const uncached = createImageApp({ root: fixtures.root, cacheSize: 0 })
    const notModified = await uncached.request('/big.jpg?fmt=webp&w=384', {
      headers: { 'if-none-match': first.headers.get('etag')! },
    })
    expect(notModified.status).toBe(304)
    expect(render).not.toHaveBeenCalled()
  })
})
