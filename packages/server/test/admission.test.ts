import { spawnSync } from 'node:child_process'
import { stat, symlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtures as vectors } from '@lazy-ease/testing'
import { Hono } from 'hono'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeMetadata, createImageApp, signCropToken, type ImageServerOptions, type SourcePolicy } from '../src/index.js'
import { createFixtures, decode, solid, split, type Fixtures } from './fixtures.js'

// Admission, revisions, viewer authorization and HTTP policy, on real renders.

let fixtures: Fixtures
beforeAll(async () => {
  fixtures = await createFixtures()
  await writeFile(path.join(fixtures.root, 'split.png'), await (await split(800, 800)).png().toBuffer())
})
afterAll(() => fixtures.cleanup())

const KEY = Buffer.from(vectors.tokens.data.keys[0]!.keyHex, 'hex')
const keys = { k1: KEY }

/** Mounted at `/_img`, as the docs say. */
function serve(options: Partial<ImageServerOptions> = {}) {
  const app = new Hono()
  app.route('/_img', createImageApp({ root: fixtures.root, ...options }))
  return (url: string, init?: RequestInit) => app.request(`/_img${url}`, init)
}

const token = (source: string, crop: { revision?: string; ar?: string; fx?: string; fy?: string }, tenant = 'demo') =>
  signCropToken({ tenant, source, ...crop }, 'k1', KEY)

describe('source policy', () => {
  it('admits uncropped and centered ladder crops by default, a focus only at the recorded one', async () => {
    const get = serve({ policy: () => ({ focalPoint: { x: 30.4, y: 45 } }) })
    expect((await get('/big.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    // With a recorded focus every ladder ratio is centered on it, so the center is another crop.
    expect((await get('/big.jpg?ar=1&fmt=webp&q=75&w=64')).status).toBe(403)
    // The policy focus is normalized the way the URL spells it.
    expect((await get('/big.jpg?ar=1&fmt=webp&fx=30&fy=45&q=75&w=64')).status).toBe(200)
    expect((await get('/big.jpg?ar=1.5&fmt=webp&fx=30&fy=45&q=75&w=64')).status).toBe(200)
    expect((await get('/big.jpg?ar=1&fmt=webp&fx=31&fy=45&q=75&w=64')).status).toBe(403)

    const centered = serve()
    expect((await centered('/big.jpg?ar=1&fmt=webp&q=75&w=64')).status).toBe(200)
    expect((await centered('/big.jpg?ar=1&fmt=webp&fx=30&fy=45&q=75&w=64')).status).toBe(403)
  })

  it('admits exactly the listed crops', async () => {
    const policy = (): SourcePolicy => ({ crops: [{ aspectRatio: 1.333 }, { aspectRatio: 1, focalPoint: { x: 20, y: 80 } }] })
    const get = serve({ policy })
    expect((await get('/big.jpg?ar=1.333&fmt=webp&q=75&w=64')).status).toBe(200)
    expect((await get('/big.jpg?ar=1&fmt=webp&fx=20&fy=80&q=75&w=64')).status).toBe(200)
    // Uncropped is a choice of its own.
    const uncropped = await get('/big.jpg?fmt=webp&q=75&w=64')
    expect(uncropped.status).toBe(403)
    expect(uncropped.headers.get('cache-control')).toBe('no-store')
    expect((await get('/big.jpg?ar=1&fmt=webp&q=75&w=64')).status).toBe(403)
    expect((await get('/big.jpg?ar=1.5&fmt=webp&q=75&w=64')).status).toBe(403)
  })

  it('treats a listed center as the centered crop', async () => {
    const get = serve({ policy: () => ({ crops: [{ aspectRatio: 1, focalPoint: { x: 50, y: 50 } }] }) })
    expect((await get('/big.jpg?ar=1&fmt=webp&q=75&w=64')).status).toBe(200)
  })

  it('fails closed on a policy revision that no v can name', async () => {
    for (const revision of ['has space', 'a'.repeat(65), '', 'r/1']) {
      const get = serve({ policy: () => ({ revision }) })
      const response = await get('/big.jpg?fmt=webp&q=75&w=64')
      expect(response.status, revision).toBe(500)
      expect(await response.text()).toBe('Internal Server Error')
    }
    expect((await serve({ policy: () => ({ revision: 'r-1.2_~' }) })('/big.jpg?fmt=webp&q=75&v=r-1.2_~&w=64')).status).toBe(200)
  })

  it('fails closed on an invalid policy without revealing it', async () => {
    const offLadder = serve({ policy: () => ({ crops: [{ aspectRatio: 1.3 }] }) })
    const response = await offLadder('/big.jpg?ar=1&fmt=webp&q=75&w=64')
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
    const focusWithoutRatio = serve({ policy: () => ({ crops: [{ focalPoint: { x: 1, y: 2 } }] }) })
    expect((await focusWithoutRatio('/big.jpg?fmt=webp&q=75&w=64')).status).toBe(500)
  })

  it('answers 404 for a source the policy does not know, before touching the file', async () => {
    const seen: string[] = []
    const get = serve({
      policy: ({ path, tenant }) => {
        seen.push(`${tenant}${path}`)
        return path === '/big.jpg' ? {} : undefined
      },
    })
    expect((await get('/small.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
    expect((await get('/does-not-exist.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
    expect((await get('/big.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    // The policy sees the canonical path, whatever the request's spelling.
    expect((await get('/my%20photos/cafe%CC%81.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
    expect(seen.at(-1)).toBe('default/my%20photos/caf%C3%A9.jpg')
  })

  it('enforces the configured formats', async () => {
    const get = serve({ formats: ['webp', 'jpeg'] })
    expect((await get('/big.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    expect((await get('/big.jpg?fmt=avif&q=75&w=64')).status).toBe(400)
    expect(() => createImageApp({ root: fixtures.root, formats: [] })).toThrow(RangeError)
  })

  it('rejects encoded slashes, empty segments and broken escapes', async () => {
    const get = serve()
    for (const url of ['/my%20photos%2Fcaf%C3%A9.jpg', '/my%20photos//caf%C3%A9.jpg', '/caf%C3.jpg', '/%C0%AF.jpg']) {
      expect((await get(`${url}?fmt=webp&q=75&w=64`)).status, url).toBe(400)
    }
  })
})

describe('crop tokens are optional', () => {
  const source = '/split.png'

  it('serves policy crops without a token and other crops only with one', async () => {
    const get = serve({ tenant: 'demo', keys, policy: () => ({ crops: [{}] }) })
    expect((await get(`${source}?fmt=webp&q=75&w=64`)).status).toBe(200)
    expect((await get(`${source}?ar=1&fmt=webp&fx=10&fy=50&q=75&w=64`)).status).toBe(403)
    const t = token(source, { ar: '1', fx: '10', fy: '50' })
    expect((await get(`${source}?ar=1&fmt=webp&fx=10&fy=50&q=75&token=${t}&w=64`)).status).toBe(200)
    // Width, format and quality stay free within the ladders under the same token.
    expect((await get(`${source}?ar=1&fmt=jpeg&fx=10&fy=50&q=75&token=${t}&w=384`)).status).toBe(200)
    // The token covers the crop and nothing else.
    expect((await get(`${source}?ar=1&fmt=webp&fx=11&fy=50&q=75&token=${t}&w=64`)).status).toBe(403)
    expect((await get(`${source}?ar=1&fmt=webp&q=75&token=${t}&w=64`)).status).toBe(403)
  })

  it('rejects an invalid token even for a crop the policy admits', async () => {
    const get = serve({ tenant: 'demo', keys })
    const wrong = token(source, { ar: '1.5' })
    expect((await get(`${source}?ar=1&fmt=webp&q=75&w=64`)).status).toBe(200)
    expect((await get(`${source}?ar=1&fmt=webp&q=75&token=${wrong}&w=64`)).status).toBe(403)
  })

  it('binds the token to the tenant', async () => {
    const get = serve({ tenant: 'other', keys, policy: () => ({ crops: [] }) })
    const forDemo = token(source, { ar: '1' })
    expect((await get(`${source}?ar=1&fmt=webp&q=75&token=${forDemo}&w=64`)).status).toBe(403)
    expect((await get(`${source}?ar=1&fmt=webp&q=75&token=${token(source, { ar: '1' }, 'other')}&w=64`)).status).toBe(200)
  })

  it('is a 400 where no keys are configured, or an empty key map', async () => {
    for (const options of [{}, { keys: {} }]) {
      const get = serve(options)
      expect((await get(`${source}?ar=1&fmt=webp&q=75&token=${token(source, { ar: '1' })}&w=64`)).status).toBe(400)
    }
  })

  it('does not make the token part of the representation', async () => {
    const get = serve({ tenant: 'demo', keys })
    const plain = await get(`${source}?ar=1&fmt=webp&q=75&w=64`)
    const signed = await get(`${source}?ar=1&fmt=webp&q=75&token=${token(source, { ar: '1' })}&w=64`)
    expect(signed.headers.get('etag')).toBe(plain.headers.get('etag'))
  })

  it('rejects malformed keys at startup', () => {
    expect(() => createImageApp({ root: fixtures.root, keys: { k1: new Uint8Array(8) } })).toThrow(RangeError)
    expect(() => createImageApp({ root: fixtures.root, keys: { 'k.1': KEY } })).toThrow(RangeError)
    expect(() => createImageApp({ root: fixtures.root, tenant: 'a b' })).toThrow(RangeError)
  })
})

describe('distinct focal representations', () => {
  it('gives two focal crops their own bytes and ETags', async () => {
    const get = serve({ tenant: 'demo', keys, policy: () => ({ crops: [] }) })
    const left = await get(`/split.png?ar=0.25&fmt=webp&fx=0&fy=50&q=75&token=${token('/split.png', { ar: '0.25', fx: '0', fy: '50' })}&w=128`)
    const right = await get(`/split.png?ar=0.25&fmt=webp&fx=100&fy=50&q=75&token=${token('/split.png', { ar: '0.25', fx: '100', fy: '50' })}&w=128`)
    expect([left.status, right.status]).toEqual([200, 200])
    expect(left.headers.get('etag')).not.toBe(right.headers.get('etag'))
    const red = async (response: Response) => (await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer())[0]!
    expect(await red(left)).toBeGreaterThan(200)
    expect(await red(right)).toBeLessThan(50)
  })
})

describe('revisions', () => {
  it('rolls over: the old revision is gone, the new one has new bytes and a new ETag', async () => {
    const file = path.join(fixtures.root, 'rolling.jpg')
    await writeFile(file, await solid(200, 200, '#000000').jpeg().toBuffer())
    let revision = 'r1'
    const get = serve({ policy: () => ({ revision }) })
    const first = await get('/rolling.jpg?fmt=jpeg&q=75&v=r1&w=64')
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    await writeFile(file, await solid(200, 200, '#ffffff').jpeg().toBuffer())
    await utimes(file, 2_000_000, 2_000_000)
    revision = 'r2'
    const stale = await get('/rolling.jpg?fmt=jpeg&q=75&v=r1&w=64')
    expect(stale.status).toBe(404)
    expect(stale.headers.get('cache-control')).toBe('no-store')
    const second = await get('/rolling.jpg?fmt=jpeg&q=75&v=r2&w=64')
    expect(second.status).toBe(200)
    expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'))
    const pixel = async (response: Response) => (await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer())[0]!
    expect(await pixel(first)).toBeLessThan(30)
    expect(await pixel(second)).toBeGreaterThan(225)
    // A conditional request with the old ETag gets the new bytes.
    const revalidated = await get('/rolling.jpg?fmt=jpeg&q=75&w=64', { headers: { 'if-none-match': first.headers.get('etag')! } })
    expect(revalidated.status).toBe(200)
  })

  it('defaults to the content revision that computeMetadata reports', async () => {
    const file = path.join(fixtures.root, 'content.jpg')
    await writeFile(file, await solid(120, 80, '#123456').jpeg().toBuffer())
    const get = serve()
    const { revision } = await computeMetadata(file)
    expect(revision).toMatch(/^[\w-]{22}$/)
    expect((await get(`/content.jpg?fmt=webp&q=75&v=${revision}&w=64`)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    // An arbitrary v cannot open a cache namespace of its own.
    expect((await get('/content.jpg?fmt=webp&q=75&v=anything&w=64')).status).toBe(404)

    await writeFile(file, await solid(120, 80, '#654321').jpeg().toBuffer())
    await utimes(file, 3_000_000, 3_000_000)
    expect((await get(`/content.jpg?fmt=webp&q=75&v=${revision}&w=64`)).status).toBe(404)
    const next = await computeMetadata(file)
    expect(next.revision).not.toBe(revision)
    expect((await get(`/content.jpg?fmt=webp&q=75&v=${next.revision}&w=64`)).status).toBe(200)
  })

  it('renders the bytes it hashed, and notices a rewrite with the same size and mtime', async () => {
    const file = path.join(fixtures.root, 'same-size.gif')
    // The pass-through only checks the header, so the payload can be any bytes of one length.
    const gif = (payload: string) => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0]), Buffer.from(payload)])
    await writeFile(file, gif('AAAA'))
    await utimes(file, 4_000_000, 4_000_000)
    const get = serve({ cacheSize: 0 })
    const first = await get('/same-size.gif')
    expect(first.status).toBe(200)

    await writeFile(file, gif('BBBB'))
    await utimes(file, 4_000_000, 4_000_000)
    // The memoized revision no longer matches the bytes: nothing is served under it.
    const changed = await get('/same-size.gif')
    expect(changed.status).toBe(503)
    expect(changed.headers.get('retry-after')).toBe('1')
    expect(changed.headers.get('cache-control')).toBe('no-store')
    const retried = await get('/same-size.gif')
    expect(retried.status).toBe(200)
    expect(Buffer.from(await retried.arrayBuffer()).subarray(10).toString()).toBe('BBBB')
    expect(retried.headers.get('etag')).not.toBe(first.headers.get('etag'))
  })

  it('revalidates a mutable URL with a conditional GET and HEAD', async () => {
    const get = serve()
    const full = await get('/big.jpg?fmt=webp&q=75&w=128')
    expect(full.headers.get('cache-control')).toBe('public, no-cache')
    const etag = full.headers.get('etag')!
    const conditional = await get('/big.jpg?fmt=webp&q=75&w=128', { headers: { 'if-none-match': etag } })
    expect(conditional.status).toBe(304)
    expect(conditional.headers.get('cache-control')).toBe('public, no-cache')
    expect(conditional.headers.get('etag')).toBe(etag)
    const head = await get('/big.jpg?fmt=webp&q=75&w=128', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(full.headers.get('content-length'))
    expect(await head.text()).toBe('')
    const conditionalHead = await get('/big.jpg?fmt=webp&q=75&w=128', { method: 'HEAD', headers: { 'if-none-match': etag } })
    expect(conditionalHead.status).toBe(304)
    // A 304 needs admission first.
    expect((await get('/big.jpg?fmt=webp&q=75&v=old&w=128', { headers: { 'if-none-match': etag } })).status).toBe(404)
  })
})

describe('private sources', () => {
  const allowed = (request: Request) => request.headers.get('authorization') === 'Bearer ok'
  const asViewer = { headers: { authorization: 'Bearer ok' } }

  it('checks the viewer before a warm hit and before a 304', async () => {
    const calls: string[] = []
    const get = serve({
      policy: ({ path }) => ({ private: path === '/big.jpg', revision: 'r1' }),
      authorize: (request, source) => {
        calls.push(source.path)
        return allowed(request)
      },
    })
    const warm = await get('/big.jpg?fmt=webp&q=75&v=r1&w=256', asViewer)
    expect(warm.status).toBe(200)
    // Even with the current v: revoked access must not stay cached for a year.
    expect(warm.headers.get('cache-control')).toBe('private, no-cache')
    // The variant is cached now; another viewer still gets no bytes.
    const denied = await get('/big.jpg?fmt=webp&q=75&v=r1&w=256')
    expect(denied.status).toBe(403)
    expect(denied.headers.get('cache-control')).toBe('no-store')
    expect(denied.headers.get('etag')).toBeNull()
    expect((await denied.arrayBuffer()).byteLength).toBeLessThan(100)
    const etag = warm.headers.get('etag')!
    expect((await get('/big.jpg?fmt=webp&q=75&v=r1&w=256', { headers: { 'if-none-match': etag } })).status).toBe(403)
    expect((await get('/big.jpg?fmt=webp&q=75&v=r1&w=256', { method: 'HEAD' })).status).toBe(403)
    expect((await get('/big.jpg?fmt=webp&q=75&v=r1&w=256', { ...asViewer, method: 'GET', headers: { ...asViewer.headers, 'if-none-match': etag } })).status).toBe(304)
    expect(calls.every((p) => p === '/big.jpg')).toBe(true)

    // Public sources do not ask.
    calls.length = 0
    expect((await get('/small.jpg?fmt=webp&q=75&w=64')).headers.get('cache-control')).toBe('public, no-cache')
    expect(calls).toEqual([])
  })

  it('checks the viewer before revealing whether a file exists', async () => {
    const get = serve({ policy: () => ({ private: true }), authorize: allowed })
    expect((await get('/missing.jpg?fmt=webp&q=75&w=64')).status).toBe(403)
    expect((await get('/missing.jpg?fmt=webp&q=75&w=64', asViewer)).status).toBe(404)
    const mutable = await get('/big.jpg?fmt=webp&q=75&w=64', asViewer)
    expect(mutable.headers.get('cache-control')).toBe('private, no-cache')
  })

  // On a case-insensitive file system (Windows, macOS by default) another letter
  // case reaches the same file under another policy identity.
  it('serves a file only under the spelling it is stored as', async (context) => {
    const caseInsensitive = await stat(fixtures.root.toUpperCase()).then(
      () => true,
      () => false,
    )
    if (!caseInsensitive) context.skip()
    await writeFile(path.join(fixtures.root, 'private.jpg'), await solid(40, 40).jpeg().toBuffer())
    const seen: string[] = []
    const get = serve({
      policy: ({ path }) => {
        seen.push(path)
        return { private: path === '/private.jpg' }
      },
      authorize: allowed,
    })
    expect((await get('/private.jpg?fmt=webp&q=75&w=64')).status).toBe(403)
    expect((await get('/private.jpg?fmt=webp&q=75&w=64', asViewer)).status).toBe(200)
    for (const alias of ['/PRIVATE.JPG', '/Private.jpg', '/private.JPG']) {
      const response = await get(`${alias}?fmt=webp&q=75&w=64`)
      expect(response.status, alias).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    // A public file too: an alias would be a cache identity of its own.
    expect((await get('/small.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    expect((await get('/SMALL.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
    expect((await get('/upper.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
    expect((await get('/UPPER.JPG?fmt=webp&q=75&w=64')).status).toBe(200)
    // Directories too.
    expect((await get('/MY%20PHOTOS/caf%C3%A9.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
    expect(seen).toContain('/PRIVATE.JPG')
  })

  it('does not serve a file under its Windows 8.3 short name', async (context) => {
    if (process.platform !== 'win32') context.skip()
    const file = path.join(fixtures.root, 'a-long-file-name.jpg')
    await writeFile(file, await solid(40, 40).jpeg().toBuffer())
    const short = path.basename(
      spawnSync('cmd', ['/d', '/s', '/c', `"for %I in ("${file}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim(),
    )
    // 8.3 names can be turned off per volume.
    if (short === path.basename(file)) context.skip()
    const get = serve()
    expect((await get('/a-long-file-name.jpg?fmt=webp&q=75&w=64')).status).toBe(200)
    expect((await get(`/${short}?fmt=webp&q=75&w=64`)).status, short).toBe(404)
  })

  it('does not serve a symlink inside the root as a second name of its target', async (context) => {
    try {
      await symlink(path.join(fixtures.root, 'small.jpg'), path.join(fixtures.root, 'alias.jpg'))
    } catch {
      // Windows needs developer mode or admin rights for symlinks.
      context.skip()
    }
    const get = serve({ policy: ({ path }) => ({ private: path === '/small.jpg' }) })
    expect((await get('/small.jpg?fmt=webp&q=75&w=64')).status).toBe(403)
    expect((await get('/alias.jpg?fmt=webp&q=75&w=64')).status).toBe(404)
  })

  it('fails closed without authorize', async () => {
    const get = serve({ policy: () => ({ private: true }) })
    expect((await get('/big.jpg?fmt=webp&q=75&w=64', asViewer)).status).toBe(403)
  })
})

describe('original pass-through', () => {
  it('serves an SVG unchanged with a sandboxing CSP', async () => {
    const get = serve()
    const response = await get('/icon.svg')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    // An SVG is never a render source.
    expect((await get('/icon.svg?fmt=webp&q=75&w=64')).status).toBe(400)
  })

  it('serves an animated GIF byte for byte, and its first frame with a transform query', async () => {
    const get = serve()
    const original = await get('/animated.gif')
    expect(original.status).toBe(200)
    expect(original.headers.get('content-type')).toBe('image/gif')
    const bytes = Buffer.from(await original.arrayBuffer())
    const { readFile } = await import('node:fs/promises')
    expect(bytes.equals(await readFile(path.join(fixtures.root, 'animated.gif')))).toBe(true)
    expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2)
    const frame = await get('/animated.gif?fmt=webp&q=75&w=64')
    expect((await decode(frame)).meta.pages ?? 1).toBe(1)
  })

  it('applies revisions, private policy and conditional requests to originals', async () => {
    const get = serve({ policy: () => ({ revision: 'r3', private: true }), authorize: (r) => r.headers.has('authorization') })
    const auth = { headers: { authorization: 'x' } }
    expect((await get('/icon.svg')).status).toBe(403)
    const pinned = await get('/icon.svg?v=r3', auth)
    expect(pinned.headers.get('cache-control')).toBe('private, no-cache')
    expect((await get('/icon.svg?v=r2', auth)).status).toBe(404)
    const etag = pinned.headers.get('etag')!
    expect((await get('/icon.svg', { headers: { authorization: 'x', 'if-none-match': etag } })).status).toBe(304)
  })

  it('refuses originals that are off, mislabeled or too large', async () => {
    expect((await serve({ originals: [] })('/icon.svg')).status).toBe(400)
    expect((await serve({ originals: ['gif'] })('/icon.svg')).status).toBe(400)
    await writeFile(path.join(fixtures.root, 'fake.svg'), 'alert(1)')
    expect((await serve()('/fake.svg')).status).toBe(400)
    await writeFile(path.join(fixtures.root, 'fake.gif'), await solid(10, 10).jpeg().toBuffer())
    expect((await serve()('/fake.gif')).status).toBe(400)
    expect((await serve({ maxInputPixels: 100 })('/animated.gif')).status).toBe(413)
    expect((await serve({ maxFileSize: 10 })('/animated.gif')).status).toBe(413)
    // Raster types are not passed through: an empty query stays a 400.
    expect((await serve()('/big.jpg')).status).toBe(400)
  })
})
