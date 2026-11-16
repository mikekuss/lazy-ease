import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs, { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageApp, diskStorage, memoryStorage, type VariantStorage } from '../src/index.js'
import { render } from '../src/render.js'
import { createFixtures, solid, type Fixtures } from './fixtures.js'

// Count real renders through the app.
vi.mock('../src/render.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/render.js')>()
  return { ...original, render: vi.fn(original.render) }
})
// Lets a test step in while the storage reads a file.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, readFile: vi.fn(original.readFile), writeFile: vi.fn(original.writeFile) }
})
// The kernel's boot id as the storage reads it; undefined for a host without one.
const BOOT_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const BOOT_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'
const boot = vi.hoisted(() => ({ id: undefined as string | undefined }))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((file: unknown, ...rest: unknown[]) => {
    if (file !== '/proc/sys/kernel/random/boot_id') return (original.readFileSync as (...args: unknown[]) => unknown)(file, ...rest)
    if (boot.id === undefined) throw Object.assign(new Error('no boot id'), { code: 'ENOENT' })
    return `${boot.id}\n`
  }) as typeof original.readFileSync
  return { ...original, readFileSync, default: { ...original, readFileSync } }
})

const DAY = 24 * 60 * 60 * 1000
const URL_A = '/big.jpg?fmt=webp&q=75&w=640'
const URL_B = '/big.jpg?fmt=webp&q=75&w=1080'

let fixtures: Fixtures
let dir: string
const open: VariantStorage[] = []

beforeAll(async () => {
  fixtures = await createFixtures()
})
afterAll(() => fixtures.cleanup())
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lazy-ease-storage-'))
  vi.mocked(render).mockClear()
  boot.id = BOOT_A
})
afterEach(async () => {
  for (const storage of open.splice(0)) await storage.close()
  await rm(dir, { recursive: true, force: true })
})

const disk = (options: Parameters<typeof diskStorage>[0] = {}) => {
  const storage = diskStorage({ dir, ...options })
  open.push(storage)
  return storage
}
const serve = (storage: VariantStorage, options: Partial<Parameters<typeof createImageApp>[0]> = {}) =>
  createImageApp({ root: fixtures.root, storage, ...options })
const objectFiles = async (base = dir) => {
  const found: string[] = []
  for (const shard of await readdir(path.join(base, 'objects')).catch(() => [])) {
    for (const name of await readdir(path.join(base, 'objects', shard))) found.push(path.join(base, 'objects', shard, name))
  }
  return found
}
const diskBytes = async () => {
  let total = 0
  for (const file of await objectFiles()) total += (await stat(file)).size
  return total
}
const fetchBody = async (app: ReturnType<typeof serve>, url: string) => {
  const response = await app.request(url)
  expect(response.status).toBe(200)
  return Buffer.from(await response.arrayBuffer())
}
const variant = (size: number, type = 'image/webp') => ({ body: new Uint8Array(size).fill(7), type })

describe('disk storage', () => {
  it('renders a cold variant once and serves it warm from disk', async () => {
    const storage = disk()
    const app = serve(storage)
    const cold = await fetchBody(app, URL_A)
    await storage.flush()
    expect(render).toHaveBeenCalledTimes(1)
    expect(await objectFiles()).toHaveLength(1)
    const warm = await app.request(URL_A)
    expect(Buffer.from(await warm.arrayBuffer()).equals(cold)).toBe(true)
    expect(warm.headers.get('content-type')).toBe('image/webp')
    expect(warm.headers.get('content-length')).toBe(String(cold.byteLength))
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('serves stored variants after a restart', async () => {
    const first = disk()
    const before = await fetchBody(serve(first), URL_A)
    await first.close()
    const second = disk()
    expect((await fetchBody(serve(second), URL_A)).equals(before)).toBe(true)
    expect(render).toHaveBeenCalledTimes(1)
    // Also once the startup scan has indexed it.
    await second.flush()
    expect((await fetchBody(serve(second), URL_A)).equals(before)).toBe(true)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('renders and writes one object for concurrent requests', async () => {
    const storage = disk()
    const app = serve(storage, { concurrency: 1 })
    const bodies = await Promise.all([0, 1, 2, 3, 4].map(() => fetchBody(app, URL_A)))
    for (const body of bodies) expect(body.equals(bodies[0]!)).toBe(true)
    await storage.flush()
    expect(render).toHaveBeenCalledTimes(1)
    expect(await objectFiles()).toHaveLength(1)
    expect(await readdir(path.join(dir, 'tmp'))).toEqual([])
  })

  it('skips a variant that is stored or being written, also across a restart', async () => {
    const storage = disk({ maxBytes: 2000, maxSourceBytes: 2000 })
    storage.put('k', variant(500), 's')
    storage.put('k', variant(500), 's')
    await storage.flush()
    storage.put('k', variant(500), 's')
    await storage.flush()
    const [file] = await objectFiles()
    const size = (await stat(file!)).size
    // The repeated puts of k were skipped (k was being written, then stored),
    // so k, l and m all fit in 2000 bytes.
    for (const key of ['l', 'm']) storage.put(key, variant(500), 's')
    await storage.flush()
    expect(await objectFiles()).toHaveLength(3)
    await storage.close()

    const again = disk({ maxBytes: 3 * size, maxSourceBytes: 3 * size })
    await again.flush()
    again.put('k', variant(500), 's')
    await again.flush()
    expect(await objectFiles()).toHaveLength(3)
    expect(await diskBytes()).toBe(3 * size)
  })

  it('counts a variant written again during the startup scan once', async () => {
    const first = disk()
    first.put('k', variant(500), 's')
    await first.close()
    const [file] = await objectFiles()
    const size = (await stat(file!)).size
    // Room for two: if k were counted twice, storing l would evict it.
    const again = disk({ maxBytes: 2 * size, maxSourceBytes: 2 * size })
    // Before flush(): the scan has not indexed k yet, so this write goes ahead.
    again.put('k', variant(500), 's')
    await again.flush()
    expect(await objectFiles()).toHaveLength(1)
    expect(await diskBytes()).toBe(size)
    again.put('l', variant(500), 's')
    await again.flush()
    expect(await objectFiles()).toHaveLength(2)
    expect(await again.get('k')).toBeDefined()
    expect(await again.get('l')).toBeDefined()
  })

  it('keeps the index entry on a read error other than a missing file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const storage = disk()
      storage.put('k', variant(10), 's')
      await storage.flush()
      const [file] = await objectFiles()
      const bytes = await readFile(file!)
      // A directory in place of the file: the read fails with EISDIR (or EPERM).
      await rm(file!)
      await mkdir(file!)
      expect(await storage.get('k')).toBeUndefined()
      expect(error).toHaveBeenCalledTimes(1)
      await rm(file!, { recursive: true })
      await writeFile(file!, bytes)
      expect(await storage.get('k')).toBeDefined()
    } finally {
      error.mockRestore()
    }
  })

  it('keeps a variant evicted and stored again while a read of its old file misses', async () => {
    const storage = disk({ maxEntries: 1 })
    storage.put('k', variant(10), 's')
    await storage.flush()
    vi.mocked(fsPromises.readFile).mockImplementationOnce(async () => {
      // During the read: l evicts k and deletes its file, then k is stored again.
      storage.put('l', variant(10), 's')
      await storage.flush()
      storage.put('k', variant(10), 's')
      await storage.flush()
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    })
    expect(await storage.get('k')).toBeUndefined()
    expect(await objectFiles()).toHaveLength(1)
    expect(await storage.get('k')).toBeDefined()
  })

  it('evicts the least recently used variant and renders it again when asked', async () => {
    const probe = memoryStorage()
    const [a, b] = [(await fetchBody(serve(probe), URL_A)).byteLength, (await fetchBody(serve(probe), URL_B)).byteLength]
    vi.mocked(render).mockClear()
    // Headers take some bytes too: room for the larger one and a little more, not both.
    const limit = Math.max(a, b) + 600
    const storage = disk({ maxBytes: limit, maxSourceBytes: limit })
    const app = serve(storage)
    await fetchBody(app, URL_A)
    await storage.flush()
    await fetchBody(app, URL_B)
    await storage.flush()
    expect(await objectFiles()).toHaveLength(1)
    expect(await diskBytes()).toBeLessThanOrEqual(limit)
    await fetchBody(app, URL_B)
    expect(render).toHaveBeenCalledTimes(2)
    await fetchBody(app, URL_A)
    await storage.flush()
    expect(render).toHaveBeenCalledTimes(3)
    expect(await objectFiles()).toHaveLength(1)
  })

  it('holds each source to its quota without evicting other sources', async () => {
    const storage = disk({ maxBytes: 10_000, maxSourceBytes: 2500 })
    // One at a time, so recency follows the order of the writes.
    for (const [key, source] of [['x0', 'x'], ['y0', 'y'], ['x1', 'x'], ['x2', 'x'], ['x3', 'x'], ['x4', 'x'], ['x5', 'x']]) {
      storage.put(key!, variant(1000), source!)
      await storage.flush()
    }
    expect(await storage.get('y0')).toBeDefined()
    const kept = await Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => (await storage.get(`x${i}`)) !== undefined))
    expect(kept).toEqual([false, false, false, false, true, true])
  })

  it('skips variants larger than the byte cap or the source quota', async () => {
    const storage = disk({ maxBytes: 1000, maxSourceBytes: 1000 })
    storage.put('big', variant(1000), 's')
    await storage.flush()
    expect(await objectFiles()).toEqual([])
    expect(await storage.get('big')).toBeUndefined()

    const tiny = memoryStorage({ maxBytes: 100 })
    tiny.put('big', variant(13), 's')
    expect(await tiny.get('big')).toBeUndefined()
  })

  it('cleans up after an interrupted publication at startup', async () => {
    const first = disk()
    await fetchBody(serve(first), URL_A)
    await fetchBody(serve(first), URL_B)
    await first.close()
    const [kept, cut] = await objectFiles()
    // A write that never got to its rename, one that was renamed but not
    // flushed, and files that are not the storage's own.
    await writeFile(path.join(dir, 'tmp', `${'a'.repeat(32)}.tmp`), 'partial')
    await truncate(cut!, 100)
    await writeFile(path.join(dir, 'objects', 'notes.txt'), 'mine')
    const misnamed = path.join(path.dirname(kept!), path.basename(path.dirname(kept!)) + 'f'.repeat(62))
    await writeFile(misnamed, await readFile(kept!))

    const second = disk()
    await second.flush()
    expect(await readdir(path.join(dir, 'tmp'))).toEqual([])
    expect(existsSync(cut!)).toBe(false)
    expect(existsSync(misnamed)).toBe(false)
    expect(existsSync(kept!)).toBe(true)
    expect(await readFile(path.join(dir, 'objects', 'notes.txt'), 'utf8')).toBe('mine')
  })

  it('treats a file damaged after startup as a miss', async () => {
    const storage = disk()
    const app = serve(storage)
    await fetchBody(app, URL_A)
    await storage.flush()
    const [file] = await objectFiles()
    await truncate(file!, 50)
    await fetchBody(app, URL_A)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('reports a failed write once and keeps serving', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const storage = disk()
      await storage.flush()
      // A file where the shard directory has to be.
      const key = '\0blocked'
      const name = createHash('sha256').update(key).digest('hex')
      await writeFile(path.join(dir, 'objects', name.slice(0, 2)), 'x')
      storage.put(key, variant(10), 's')
      storage.put(`${key}`, variant(10), 's')
      await storage.flush()
      storage.put(key, variant(10), 's')
      await storage.flush()
      expect(error).toHaveBeenCalledTimes(1)
      expect(await storage.get(key)).toBeUndefined()
      expect(await readdir(path.join(dir, 'tmp'))).toEqual([])
    } finally {
      error.mockRestore()
    }
  })

  it('expires variants unused for maxAge at startup, keeping recency in the file time', async () => {
    const first = disk()
    first.put('old', variant(10), 's')
    first.put('new', variant(10), 's')
    await first.close()
    const files = await objectFiles()
    const oldFile = files.find((f) => f.endsWith(createHash('sha256').update('old').digest('hex')))!
    const past = new Date(Date.now() - 31 * DAY)
    await utimes(oldFile, past, past)
    const second = disk()
    await second.flush()
    expect(await second.get('old')).toBeUndefined()
    expect(await second.get('new')).toBeDefined()
    expect(existsSync(oldFile)).toBe(false)
  })

  it('applies lowered limits at startup, evicting the oldest first', async () => {
    const first = disk({ maxBytes: 10_000, maxSourceBytes: 10_000 })
    for (const key of ['a', 'b', 'c']) {
      first.put(key, variant(1000), 's')
      await first.flush()
    }
    await first.close()
    const files = await objectFiles()
    const size = (await stat(files[0]!)).size
    for (const [i, key] of ['a', 'b', 'c'].entries()) {
      const at = new Date(Date.now() - (3 - i) * 1000)
      await utimes(files.find((f) => f.endsWith(createHash('sha256').update(key).digest('hex')))!, at, at)
    }
    const second = disk({ maxBytes: 2 * size, maxSourceBytes: 2 * size })
    await second.flush()
    expect(await second.get('a')).toBeUndefined()
    expect(await second.get('b')).toBeDefined()
    expect(await second.get('c')).toBeDefined()
  })

  it('serves a rewritten source with new bytes, and its old variants age out first', async () => {
    const file = path.join(fixtures.root, 'rewritten.jpg')
    await solid(800, 600, '#ff0000').jpeg().toFile(file)
    const storage = disk({ maxBytes: 1_000_000, maxSourceBytes: 1_000_000 })
    const app = serve(storage)
    const url = '/rewritten.jpg?fmt=webp&q=75&w=64'
    const red = await fetchBody(app, url)
    await storage.flush()
    await solid(800, 600, '#0000ff').jpeg().toFile(file)
    const later = new Date(Date.now() + 5000)
    await utimes(file, later, later)
    const blue = await fetchBody(app, url)
    expect(blue.equals(red)).toBe(false)
    expect(render).toHaveBeenCalledTimes(2)
    await storage.flush()
    expect(await objectFiles()).toHaveLength(2)
    // The stale variant is the least recently used, so the source quota drops it first.
    await storage.close()
    open.splice(open.indexOf(storage), 1)
    const tight = disk({ maxBytes: 1_000_000, maxSourceBytes: Math.max(...(await Promise.all((await objectFiles()).map(async (f) => (await stat(f)).size)))) })
    await tight.flush()
    expect(await objectFiles()).toHaveLength(1)
    expect((await fetchBody(serve(tight), url)).equals(blue)).toBe(true)
    expect(render).toHaveBeenCalledTimes(2)
  })
})

describe('disk storage ownership', () => {
  it('shares one storage per directory in a process, and refuses other limits', async () => {
    const a = disk()
    expect(disk()).toBe(a)
    expect(() => diskStorage({ dir, maxBytes: 5 })).toThrow(/other limits/)
  })

  it('releases a shared directory when the last caller closes it', async () => {
    const a = disk()
    const b = disk()
    await a.close()
    expect(existsSync(path.join(dir, 'LOCK'))).toBe(true)
    b.put('k', variant(10), 's')
    await b.flush()
    expect(await b.get('k')).toBeDefined()
    await b.close()
    expect(existsSync(path.join(dir, 'LOCK'))).toBe(false)
    expect(await b.get('k')).toBeUndefined()
  })

  it('refuses a directory a live process holds', async () => {
    // The parent of this test process is alive for its whole run.
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'LOCK'), `${process.ppid} ${hostname()} 1000 ${BOOT_A} feedbeef\n`)
    expect(() => diskStorage({ dir })).toThrow(/in use by another process.*remove .*LOCK by hand/)
    await writeFile(path.join(dir, 'LOCK'), `1 another-host 1000 ${BOOT_B} feedbeef\n`)
    expect(() => diskStorage({ dir })).toThrow(/in use/)
  })

  it('takes over a lock of this pid from an earlier start, as for PID 1 in a restarted container', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'LOCK'), `${process.pid} ${hostname()} 1000 ${BOOT_A} feedbeef\n`)
    disk()
    expect(await readFile(path.join(dir, 'LOCK'), 'utf8')).not.toMatch(/feedbeef/)
  })

  it('takes over a lock that has not been refreshed, whatever process or host it names', async () => {
    const past = new Date(Date.now() - 2 * 60 * 1000)
    for (const held of [`${process.ppid} ${hostname()} 1000 ${BOOT_A} feedbeef`, `1 another-host 1000 ${BOOT_B} feedbeef`]) {
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, 'LOCK'), `${held}\n`)
      await utimes(path.join(dir, 'LOCK'), past, past)
      const storage = diskStorage({ dir })
      expect(await readFile(path.join(dir, 'LOCK'), 'utf8')).toMatch(new RegExp(`^${process.pid} `))
      await storage.close()
    }
  })

  it('refreshes its own lock, and stops when closed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const storage = disk()
      const file = path.join(dir, 'LOCK')
      const past = new Date(Date.now() - 2 * 60 * 1000)
      await utimes(file, past, past)
      vi.advanceTimersByTime(10_000)
      expect(Date.now() - (await stat(file)).mtimeMs).toBeLessThan(30_000)
      await storage.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes over a lock of this host from another boot, even with a live pid and a future mtime', async () => {
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'LOCK')
    const future = new Date(Date.now() + 60 * 60 * 1000)
    await writeFile(file, `${process.ppid} ${hostname()} 1000 ${BOOT_B} feedbeef\n`)
    await utimes(file, future, future)
    const storage = diskStorage({ dir })
    expect((await readFile(file, 'utf8')).split(' ')).toEqual([String(process.pid), hostname(), expect.any(String), BOOT_A, expect.stringMatching(/^[0-9a-f]{16}\n$/)])
    await storage.close()
    // The same boot and a fresh mtime: the live process keeps it.
    await writeFile(file, `${process.ppid} ${hostname()} 1000 ${BOOT_A} feedbeef\n`)
    expect(() => diskStorage({ dir })).toThrow(/in use by another process/)
  })

  it('skips the boot check on a host without a boot id, leaving the pid check', async () => {
    boot.id = undefined
    const file = path.join(dir, 'LOCK')
    const own = disk()
    expect((await readFile(file, 'utf8')).split(' ')[3]).toBe('-')
    await own.close()
    await writeFile(file, `${process.ppid} ${hostname()} 1000 ${BOOT_B} feedbeef\n`)
    expect(() => diskStorage({ dir })).toThrow(/in use by another process/)
    const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString()
    await writeFile(file, `${exited} ${hostname()} 1000 - feedbeef\n`)
    const storage = diskStorage({ dir })
    expect(await readFile(file, 'utf8')).toMatch(new RegExp(`^${process.pid} `))
    await storage.close()
  })

  it('takes over an empty or unparsable lock once it is a few seconds old', async () => {
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'LOCK')
    for (const text of ['', 'cut short']) {
      await writeFile(file, text)
      expect(() => diskStorage({ dir })).toThrow(/in use by another process/)
      const past = new Date(Date.now() - 10_000)
      await utimes(file, past, past)
      const storage = diskStorage({ dir })
      expect(await readFile(file, 'utf8')).toMatch(new RegExp(`^${process.pid} `))
      await storage.close()
    }
  })

  it('puts a lock back by rename where links are not supported', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const link = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('not supported'), { code: 'EPERM' })
    })
    const original = fs.renameSync
    const live = `${process.ppid} ${hostname()} 1000 ${BOOT_A} feedbeef\n`
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce((from, to) => {
      // Between the read and the move aside, a live process took the stale lock over.
      writeFileSync(from, live)
      original(from, to)
    })
    try {
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, 'LOCK')
      await writeFile(file, `1 another-host 1000 ${BOOT_B} feedbeef\n`)
      const past = new Date(Date.now() - 2 * 60 * 1000)
      await utimes(file, past, past)
      expect(() => diskStorage({ dir })).toThrow(/in use by another process/)
      expect(link).toHaveBeenCalledTimes(1)
      expect(rename).toHaveBeenCalledTimes(2)
      expect(await readFile(file, 'utf8')).toBe(live)
      expect(readdirSync(dir).filter((name) => name.startsWith('LOCK'))).toEqual(['LOCK'])
      expect(error).not.toHaveBeenCalled()
    } finally {
      link.mockRestore()
      rename.mockRestore()
      error.mockRestore()
    }
  })

  for (const [what, steal] of [
    ['taken over', (file: string) => writeFile(file, `${process.ppid} ${hostname()} 1000 ${BOOT_A} feedbeef\n`)],
  ] as const) {
    it(`stays off the directory once its lock is ${what}`, async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const storage = disk()
        storage.put('k', variant(10), 's')
        await storage.flush()
        const file = path.join(dir, 'LOCK')
        await steal(file)
        const held = existsSync(file) ? await readFile(file, 'utf8') : undefined
        vi.advanceTimersByTime(10_000)
        expect(error).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
        expect(await storage.get('k')).toBeUndefined()
        storage.put('l', variant(10), 's')
        await storage.flush()
        expect(await objectFiles()).toHaveLength(1)
        vi.advanceTimersByTime(30_000)
        expect(error).toHaveBeenCalledTimes(1)
        await storage.close()
        // Its release leaves the LOCK as it found it.
        expect(existsSync(file) ? await readFile(file, 'utf8') : undefined).toBe(held)
      } finally {
        error.mockRestore()
        vi.useRealTimers()
      }
    })
  }

  it('writes its lock again when it was removed, and keeps storing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const storage = disk()
      const file = path.join(dir, 'LOCK')
      const owner = await readFile(file, 'utf8')
      await rm(file)
      vi.advanceTimersByTime(10_000)
      expect(await readFile(file, 'utf8')).toBe(owner)
      expect(vi.getTimerCount()).toBe(1)
      storage.put('k', variant(10), 's')
      await storage.flush()
      expect(await storage.get('k')).toBeDefined()
      expect(error).not.toHaveBeenCalled()
      await storage.close()
      expect(existsSync(file)).toBe(false)
    } finally {
      error.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not publish a write that was under way when the lock was lost', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const storage = disk()
      await storage.flush()
      const file = path.join(dir, 'LOCK')
      vi.mocked(fsPromises.writeFile).mockImplementationOnce(async (temp, data, options) => {
        writeFileSync(temp as string, data as Buffer, options as { flag: string })
        // While the temporary file is written, another process takes the directory over.
        writeFileSync(file, `${process.ppid} ${hostname()} 1000 ${BOOT_A} feedbeef\n`)
        vi.advanceTimersByTime(10_000)
      })
      storage.put('k', variant(10), 's')
      await storage.flush()
      expect(error).toHaveBeenCalledTimes(1)
      expect(await objectFiles()).toEqual([])
      expect(await readdir(path.join(dir, 'tmp'))).toEqual([])
      await storage.close()
    } finally {
      error.mockRestore()
      vi.useRealTimers()
    }
  })

  it('refuses to reopen a directory while it is still being closed', async () => {
    const storage = disk()
    const closing = storage.close()
    expect(() => diskStorage({ dir })).toThrow(/still being closed/)
    await closing
    disk()
    expect(existsSync(path.join(dir, 'LOCK'))).toBe(true)
  })

  it('takes over the lock of a process that has exited, and releases its own on close', async () => {
    const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString()
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'LOCK'), `${exited} ${hostname()} 1000 ${BOOT_A} feedbeef\n`)
    const storage = diskStorage({ dir })
    expect(await readFile(path.join(dir, 'LOCK'), 'utf8')).toMatch(new RegExp(`^${process.pid} `))
    await storage.close()
    expect(existsSync(path.join(dir, 'LOCK'))).toBe(false)
    expect(await readdir(dir)).toEqual(['objects', 'tmp'])
  })

  it('must not overlap the source root', async () => {
    expect(() => createImageApp({ root: fixtures.root, storage: disk({ dir: path.join(fixtures.root, 'cache') }) })).toThrow(/overlap/)
    expect(() => createImageApp({ root: path.join(dir, 'images'), storage: disk() })).toThrow(/overlap/)
  })

  it('compares real paths, so a root through a link cannot hide an overlap', async () => {
    const media = path.join(dir, 'media')
    await mkdir(media)
    const link = path.join(dir, 'images')
    await symlink(media, link, 'junction')
    expect(() => createImageApp({ root: link, storage: disk({ dir: path.join(media, '.cache') }) })).toThrow(/overlap/)
  })

  it('treats a child named like ..cache as inside the root', async () => {
    const root = path.join(dir, 'root')
    await mkdir(root)
    expect(() => createImageApp({ root, storage: disk({ dir: path.join(root, '..cache') }) })).toThrow(/overlap/)
  })

  it('opens no default storage when createImageApp throws', () => {
    const cache = path.join(process.cwd(), '.cache', 'lazy-ease')
    const before = existsSync(cache)
    expect(() => createImageApp({ root: process.cwd() })).toThrow(/overlap/)
    expect(() => createImageApp({ root: fixtures.root, concurrency: 0 })).toThrow(/concurrency/)
    expect(existsSync(cache)).toBe(before)
    expect(existsSync(path.join(cache, 'LOCK'))).toBe(false)
  })

  it('points 0.2 cache options to storage', () => {
    expect(() => createImageApp({ root: fixtures.root, cacheSize: 0 } as never)).toThrow(/memoryStorage/)
  })
})

describe('memory storage', () => {
  it('is empty after a restart and writes nothing to disk', async () => {
    const cache = path.join(process.cwd(), '.cache', 'lazy-ease')
    const before = existsSync(cache) ? await objectFiles(cache) : undefined
    const first = memoryStorage()
    await fetchBody(serve(first), URL_A)
    await fetchBody(serve(first), URL_A)
    expect(render).toHaveBeenCalledTimes(1)
    await first.close()
    await fetchBody(serve(memoryStorage()), URL_A)
    expect(render).toHaveBeenCalledTimes(2)
    expect(first.dir).toBeUndefined()
    if (before === undefined) expect(existsSync(cache)).toBe(false)
    else expect(await objectFiles(cache)).toEqual(before)
  })

  it('is empty and keeps its whole capacity after close', async () => {
    const storage = memoryStorage({ maxBytes: 100, maxSourceBytes: 100 })
    storage.put('a', variant(100), 's')
    await storage.close()
    expect(await storage.get('a')).toBeUndefined()
    storage.put('b', variant(100), 's')
    expect(await storage.get('b')).toBeDefined()
  })

  it('bounds bytes, entries and each source', async () => {
    const storage = memoryStorage({ maxBytes: 300, maxEntries: 2, maxSourceBytes: 200 })
    storage.put('a', variant(100), 'x')
    storage.put('b', variant(100), 'x')
    storage.put('c', variant(100), 'x')
    expect(await storage.get('a')).toBeUndefined()
    storage.put('d', variant(100), 'y')
    expect(await storage.get('b')).toBeUndefined()
    expect(await storage.get('c')).toBeDefined()
    expect(await storage.get('d')).toBeDefined()
  })
})
