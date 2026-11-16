import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import type { Encoded } from './render.js'
import { Retention, resolveLimits, type Entry, type RetentionOptions } from './retention.js'

/**
 * Where encoded variants are kept between requests. `createImageApp` reads
 * it before rendering and writes each render to it.
 */
export interface VariantStorage {
  /** The stored variant for `key`, if any. A use counts for recency and popularity. */
  get(key: string): Promise<Encoded | undefined>
  /**
   * Stores a variant in the background and never throws. A key that is
   * stored or being written is skipped. `source` groups the variants of one
   * source for its quota.
   */
  put(key: string, value: Encoded, source: string): void
  /** Settles once startup reconciliation and every pending write have finished. */
  flush(): Promise<void>
  /**
   * Flushes, then releases the storage; a disk storage also releases its
   * directory once every `diskStorage()` call that returned it is closed.
   */
  close(): Promise<void>
  /** The directory of a disk storage. */
  readonly dir?: string
}

export type MemoryStorageOptions = RetentionOptions

/**
 * A bounded in-process cache, empty after every restart. Defaults: 64 MB,
 * 1000 variants, 8 MB per source, 30 days unused.
 */
export function memoryStorage(options: MemoryStorageOptions = {}): VariantStorage {
  const retention = new Retention(resolveLimits(options, { maxBytes: 64 * 1024 * 1024, maxEntries: 1000 }))
  const values = new Map<string, Encoded>()
  const drop = (entries: Entry[]) => {
    for (const entry of entries) values.delete(entry.key)
  }
  return {
    async get(key) {
      const value = values.get(key)
      if (value) drop(retention.touch(key, Date.now()))
      return value
    },
    put(key, value, source) {
      if (values.has(key) || !retention.fits(value.body.byteLength)) return
      values.set(key, value)
      const now = Date.now()
      drop(retention.add(key, source, value.body.byteLength, now, now))
    },
    async flush() {},
    async close() {
      values.clear()
      retention.clear()
    },
  }
}

export interface DiskStorageOptions extends RetentionOptions {
  /**
   * Directory owned by this storage, outside the source root. One process
   * owns it at a time (a `LOCK` file). In that process, `diskStorage()` for
   * the same directory and limits returns the same shared storage, and the
   * directory is released when the last caller closes it. Default
   * `.cache/lazy-ease` under the working directory.
   */
  dir?: string
}

const MAGIC = Buffer.from('lazy-ease variant 1\n')
const MAX_HEADER = 64 * 1024
const OBJECT_NAME = /^[0-9a-f]{64}$/
const SHARD_NAME = /^[0-9a-f]{2}$/
const TEMP_NAME = /^[0-9a-f]{32}\.tmp$/
/** A use rewrites a file's mtime, which survives restarts as its recency, at most this often. */
const STAMP_INTERVAL = 60 * 60 * 1000
const SCAN_CONCURRENCY = 8
const REGISTRY = Symbol.for('@lazy-ease/server/disk-storage')

interface Header {
  key: string
  source: string
  type: string
  length: number
}

type Registry = Map<string, { storage: VariantStorage; signature: string; retain(): void }>
const registry = ((globalThis as Record<symbol, unknown>)[REGISTRY] ??= new Map()) as Registry
/** Directories of this process whose storage is closing and has not released its lock yet. */
const closing = ((globalThis as Record<symbol, unknown>)[Symbol.for('@lazy-ease/server/disk-storage-closing')] ??=
  new Set()) as Set<string>
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code

/**
 * The default storage: a byte-bounded disk cache that survives restarts.
 * Each variant is one file, published by an atomic rename from `tmp/`. At
 * startup abandoned temporary files are removed and `objects/` is
 * reconciled into the in-memory index, oldest first; files that are
 * truncated, misnamed or over the limits are deleted, and only files named
 * like objects are ever touched. Defaults: 1 GB, 100 000 variants, 128 MB
 * per source, 30 days unused.
 *
 * A directory already open in this process is shared: each call returns
 * the same storage and takes a reference, and each `close()` drops one. The
 * storage `createImageApp` opens by default holds no reference, so
 * `diskStorage().close()` closes it.
 *
 * Throws if another process holds the directory, if this process holds it
 * with other limits, or if this process is still closing it (await that
 * `close()` first).
 *
 * If another process takes the directory over (this one stalled for a
 * minute), the storage stops using it, as if closed: every `get` misses and
 * every `put` is dropped.
 */
export function diskStorage(options: DiskStorageOptions = {}): VariantStorage {
  return openDisk(options, true)
}

/** Where `createImageApp` keeps variants when it is given no storage. */
export function defaultStorageDir(): string {
  return path.join(process.cwd(), '.cache', 'lazy-ease')
}

/** The default storage of `createImageApp`: shared with `diskStorage()`, without taking a reference. */
export function defaultStorage(): VariantStorage {
  return openDisk({}, false)
}

function openDisk(options: DiskStorageOptions, reference: boolean): VariantStorage {
  const limits = resolveLimits(options, { maxBytes: 1024 * 1024 * 1024, maxEntries: 100_000 })
  const signature = JSON.stringify(limits)
  const objects = path.join(path.resolve(options.dir ?? defaultStorageDir()), 'objects')
  fs.mkdirSync(objects, { recursive: true })
  const dir = fs.realpathSync(path.dirname(objects))
  const shared = registry.get(dir)
  if (shared) {
    if (shared.signature !== signature) throw new RangeError(`The cache directory ${dir} is already open with other limits`)
    if (reference) shared.retain()
    return shared.storage
  }
  if (closing.has(dir)) {
    throw new Error(`The cache directory ${dir} is still being closed in this process; await its close() before opening it again`)
  }
  const tempDir = path.join(dir, 'tmp')
  fs.mkdirSync(tempDir, { recursive: true })
  let scanned = false
  let closed = false
  /** Set when another process has taken the directory over: the storage then stays off it. */
  let lost = false
  const onLost = (reason: string) => {
    lost = true
    if (registry.get(dir)?.storage === storage) registry.delete(dir)
    process.off('exit', onExit)
    console.error(`lazy-ease: the cache lock ${path.join(dir, 'LOCK')} was ${reason}; this storage no longer reads or writes ${dir}`)
  }
  const releaseLock = lock(dir, onLost)
  try {
    // Before any write of this run: what is left in tmp/ was abandoned by an earlier one.
    for (const name of fs.readdirSync(tempDir)) {
      if (TEMP_NAME.test(name)) fs.rmSync(path.join(tempDir, name), { force: true })
    }
  } catch (error) {
    releaseLock()
    throw error
  }
  const onExit = () => releaseLock()
  process.once('exit', onExit)

  const retention = new Retention(limits)
  const writing = new Map<string, Encoded>()
  const jobs = new Set<Promise<void>>()
  /** When each file's mtime was last set to its recency. */
  const stamped = new Map<string, number>()
  /** Open `diskStorage()` calls that returned this storage. */
  let references = reference ? 1 : 0
  /** Writes that finished before the scan, indexed after the scanned files so recency stays in order. */
  const late: { key: string; source: string; bytes: number; at: number }[] = []
  const reported = new Set<string>()

  const objectPath = (key: string) => {
    const name = createHash('sha256').update(key).digest('hex')
    return path.join(dir, 'objects', name.slice(0, 2), name)
  }
  const report = (what: string, error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown'
    if (reported.has(`${what} ${code}`)) return
    reported.add(`${what} ${code}`)
    console.error(`lazy-ease: cache ${what} failed in ${dir} (${code})`, error)
  }
  const track = (job: Promise<void>) => {
    jobs.add(job)
    void job.finally(() => jobs.delete(job))
  }
  const evict = (entries: readonly Pick<Entry, 'key'>[]) => {
    if (lost) return
    for (const entry of entries) {
      stamped.delete(entry.key)
      // A file left behind (e.g. still open elsewhere on Windows) is found again by the next startup.
      track(rm(objectPath(entry.key), { force: true }).catch((error: unknown) => report('eviction', error)))
    }
  }

  /** The valid objects on disk, oldest first. Deletes invalid ones. */
  const scan = async () => {
    const files: string[] = []
    for (const shard of await readdir(path.join(dir, 'objects'))) {
      if (!SHARD_NAME.test(shard)) continue
      for (const name of await readdir(path.join(dir, 'objects', shard)).catch(() => [])) {
        if (OBJECT_NAME.test(name) && name.startsWith(shard)) files.push(path.join(dir, 'objects', shard, name))
      }
    }
    const found: { key: string; source: string; bytes: number; at: number }[] = []
    let next = 0
    const worker = async () => {
      while (next < files.length && !lost) {
        const file = files[next++]!
        const record = await inspect(file).catch(() => undefined)
        if (record === null) {
          if (!lost) await rm(file, { force: true }).catch((error: unknown) => report('cleanup', error))
        } else if (record) found.push(record)
      }
    }
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
    return found.sort((a, b) => a.at - b.at)
  }
  /** Indexes the scanned objects and the writes that finished meanwhile, in one synchronous step. */
  const settle = (found: { key: string; source: string; bytes: number; at: number }[]) => {
    const now = Date.now()
    // Writes during the scan come last: they are the most recent uses. A key
    // written again replaces its scanned record, so it is counted once.
    for (const record of [...found, ...late]) {
      if (retention.fits(record.bytes)) evict(retention.add(record.key, record.source, record.bytes, record.at, now))
      else evict([record])
    }
    late.length = 0
    scanned = true
    evict(retention.expire(now, true))
    evict(retention.enforce())
  }
  /** A valid object's index record, `null` for a file to delete, `undefined` for one to leave alone. */
  const inspect = async (file: string) => {
    // lstat leaves symlinks alone. Size and time come from the file that was
    // opened, which a write during the scan may have renamed over the old one.
    if (!(await lstat(file)).isFile()) return undefined
    const handle = await open(file, 'r')
    let head: Buffer
    let info: fs.Stats
    try {
      info = await handle.stat()
      head = Buffer.alloc(Math.min(info.size, MAGIC.length + MAX_HEADER))
      const { bytesRead } = await handle.read(head, 0, head.length, 0)
      head = head.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    const parsed = parseHeader(head)
    if (!parsed || objectPath(parsed.header.key) !== file || info.size !== parsed.offset + parsed.header.length) return null
    return { key: parsed.header.key, source: parsed.header.source, bytes: info.size, at: info.mtimeMs }
  }
  const ready = scan()
    .catch((error: unknown) => {
      report('startup scan', error)
      return []
    })
    .then(settle)

  const write = async (key: string, source: string, data: Buffer) => {
    const temp = path.join(tempDir, `${randomBytes(16).toString('hex')}.tmp`)
    const file = objectPath(key)
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(temp, data, { flag: 'wx' })
      // A write under way when the lock was lost is not published. `closed`
      // is not checked: close() lets pending writes finish before it
      // releases the lock.
      if (lost) {
        await rm(temp, { force: true }).catch(() => {})
        return
      }
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      if (!lost) report('write', error)
      return
    }
    // A rename already under way when the loss was detected has landed; it is not indexed.
    if (lost) return
    const now = Date.now()
    stamped.set(key, now)
    if (!scanned) late.push({ key, source, bytes: data.byteLength, at: now })
    else evict(retention.add(key, source, data.byteLength, now, now))
  }

  const storage: VariantStorage = {
    dir,
    async get(key) {
      if (closed || lost) return undefined
      const pending = writing.get(key)
      if (pending) return pending
      const seen = retention.get(key)
      // Before the scan has finished, a file the index does not know yet is still read.
      if (scanned && !seen) return undefined
      const file = objectPath(key)
      // Forgets only the entry this read was for: the key may have been
      // evicted and stored again meanwhile, and that file must stay indexed.
      const forget = () => {
        if (lost || retention.get(key) !== seen || writing.has(key)) return false
        retention.remove(key)
        stamped.delete(key)
        return true
      }
      let data: Buffer
      try {
        data = await readFile(file)
      } catch (error) {
        // Other errors (EMFILE, EBUSY, EPERM) pass: the entry stays, so the
        // file stays counted, and this request is a miss.
        if (errorCode(error) === 'ENOENT') forget()
        else if (!lost) report('read', error)
        return undefined
      }
      if (lost) return undefined
      const parsed = parseHeader(data)
      if (!parsed || parsed.header.key !== key || data.byteLength !== parsed.offset + parsed.header.length) {
        if (forget()) await rm(file, { force: true }).catch(() => {})
        return undefined
      }
      const now = Date.now()
      if (retention.get(key)) {
        evict(retention.touch(key, now))
        if (now - (stamped.get(key) ?? 0) >= STAMP_INTERVAL) {
          stamped.set(key, now)
          const at = new Date(now)
          utimes(file, at, at).catch(() => {})
        }
      }
      return { body: data.subarray(parsed.offset), type: parsed.header.type }
    },
    put(key, value, source) {
      if (closed || lost || writing.has(key) || retention.get(key)) return
      const header = encodeHeader({ key, source, type: value.type, length: value.body.byteLength })
      const bytes = header.byteLength + value.body.byteLength
      if (!retention.fits(bytes)) return
      writing.set(key, value)
      track(
        write(key, source, Buffer.concat([header, value.body])).finally(() => {
          writing.delete(key)
        }),
      )
    },
    async flush() {
      await ready
      while (jobs.size > 0) await Promise.all(jobs)
    },
    async close() {
      if (closed) return
      if (references > 1) {
        references--
        return
      }
      references = 0
      closed = true
      // From here on a diskStorage() call for this directory does not get
      // this storage: it throws until the lock is released below.
      const registered = registry.get(dir)?.storage === storage
      if (registered) {
        registry.delete(dir)
        closing.add(dir)
      }
      try {
        await storage.flush()
      } finally {
        process.off('exit', onExit)
        releaseLock()
        if (registered) closing.delete(dir)
      }
    },
  }
  registry.set(dir, {
    storage,
    signature,
    retain: () => {
      references++
    },
  })
  return storage
}

function encodeHeader(header: Header): Buffer {
  return Buffer.concat([MAGIC, Buffer.from(`${JSON.stringify(header)}\n`)])
}

function parseHeader(data: Buffer): { header: Header; offset: number } | undefined {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) return undefined
  const end = data.indexOf(0x0a, MAGIC.length)
  if (end < 0 || end - MAGIC.length > MAX_HEADER) return undefined
  try {
    const header = JSON.parse(data.subarray(MAGIC.length, end).toString('utf8')) as Header
    if (typeof header.key !== 'string' || typeof header.source !== 'string') return undefined
    if (typeof header.type !== 'string' || !/^image\/[a-z0-9.+-]+$/.test(header.type)) return undefined
    if (!Number.isSafeInteger(header.length) || header.length < 0) return undefined
    return { header, offset: end + 1 }
  } catch {
    return undefined
  }
}

/** A live owner rewrites the mtime of its `LOCK` this often. */
const HEARTBEAT = 10_000
/** A `LOCK` whose mtime is older than this is stale, whatever process or host it names. */
const LOCK_STALE = 60_000
/** An empty or unparsable `LOCK` (a write cut short, e.g. by a full disk) is stale once it is this old. */
const LOCK_UNREADABLE_STALE = 5_000
/** When this process started, in ms: tells apart a later process with the same pid (PID 1 in a container). */
const STARTED = String(Math.round(Date.now() - process.uptime() * 1000))
const BOOT_ID = '/proc/sys/kernel/random/boot_id'

/**
 * Which boot of this host this process runs in: the kernel's boot id, or
 * `-` where there is none (macOS, Windows). A same-host lock from another
 * boot is stale whatever its mtime says, so a host whose clock is behind
 * after a reboot (no RTC) does not see its own old lock as fresh.
 */
function bootIdentity(): string {
  try {
    const id = fs.readFileSync(BOOT_ID, 'utf8').trim()
    if (/^[0-9a-f-]+$/.test(id) && id !== '-') return id
  } catch {}
  return '-'
}

interface HeldLock {
  text: string
  mtimeMs: number
}

/**
 * Takes the directory's `LOCK` file (`pid host start boot token`), or throws
 * if a live process holds it. The owner refreshes the file's mtime every
 * `HEARTBEAT`. A lock not refreshed for `LOCK_STALE`, or left by a process
 * of this host that no longer runs or ran in an earlier boot, is taken over.
 * `onLost` runs once if the heartbeat finds the lock taken over. Returns
 * the release function.
 */
function lock(dir: string, onLost: (reason: string) => void): () => void {
  const file = path.join(dir, 'LOCK')
  const boot = bootIdentity()
  const owner = `${process.pid} ${hostname()} ${STARTED} ${boot} ${randomBytes(8).toString('hex')}\n`
  const inUse = (held: string) =>
    new Error(
      `The cache directory ${dir} is in use by another process (LOCK: ${held.trim()}). ` +
        `If no process uses it, remove ${file} by hand; a LOCK not refreshed for ${LOCK_STALE / 1000} s is taken over.`,
    )
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, owner, { flag: 'wx' })
      return hold(file, owner, onLost)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const held = readLock(file)
    if (held === undefined) continue
    if (!stale(held, boot)) throw inUse(held.text)
    // Move the stale lock aside and check it is still the one that was read
    // and still stale: another process may have taken it over meanwhile, or
    // its owner may have refreshed it.
    const aside = `${file}.${randomBytes(8).toString('hex')}`
    try {
      fs.renameSync(file, aside)
    } catch {
      continue
    }
    const moved = readLock(aside)
    if (moved === undefined || moved.text !== held.text || !stale(moved, boot)) {
      putBack(aside, file)
      throw inUse(moved?.text ?? '')
    }
    fs.rmSync(aside, { force: true })
  }
  throw new Error(`Could not lock the cache directory ${dir}`)
}

/**
 * Puts a lock that was moved aside back in place. A link leaves a LOCK that
 * a third process has created meanwhile alone; where links are not
 * supported (exFAT, some SMB shares) a rename is the fallback. `aside` is
 * removed only once the lock is back, or when a third LOCK exists.
 */
function putBack(aside: string, file: string) {
  try {
    fs.linkSync(aside, file)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      try {
        fs.renameSync(aside, file)
      } catch (failure) {
        console.error(`lazy-ease: could not put the cache lock ${aside} back to ${file}`, failure)
      }
      return
    }
  }
  fs.rmSync(aside, { force: true })
}

/**
 * Keeps a taken lock fresh until the returned release function runs, or
 * until it is lost. A LOCK that is gone is written again: a takeover
 * attempt that moves it aside puts it back, and if that put-back finds this
 * new LOCK, the lock is still this owner's.
 */
function hold(file: string, owner: string, onLost: (reason: string) => void): () => void {
  let lost = false
  const lose = (reason: string) => {
    lost = true
    clearInterval(heartbeat)
    onLost(reason)
  }
  const heartbeat = setInterval(() => {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return
      try {
        fs.writeFileSync(file, owner, { flag: 'wx' })
        return
      } catch (failure) {
        if (errorCode(failure) !== 'EEXIST') return lose('removed and could not be written again')
      }
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        return
      }
    }
    if (text !== owner) return lose('taken over by another process')
    try {
      const now = new Date()
      fs.utimesSync(file, now, now)
    } catch {}
  }, HEARTBEAT)
  heartbeat.unref()
  return () => {
    clearInterval(heartbeat)
    if (lost) return
    try {
      if (fs.readFileSync(file, 'utf8') === owner) fs.rmSync(file, { force: true })
    } catch {}
  }
}

function readLock(file: string): HeldLock | undefined {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return { text, mtimeMs: fs.statSync(file).mtimeMs }
  } catch {
    return undefined
  }
}

/**
 * A lock not refreshed for `LOCK_STALE`, an empty or unparsable one older
 * than `LOCK_UNREADABLE_STALE`, or one of this host from another boot, or
 * whose process has exited or was an earlier process with this pid. `boot`
 * is this process's boot identity; the boot check needs both to be known.
 */
function stale({ text, mtimeMs }: HeldLock, boot: string): boolean {
  const age = Date.now() - mtimeMs
  if (age > LOCK_STALE) return true
  const fields = text.trim().split(' ')
  if (fields.length !== 5) return age > LOCK_UNREADABLE_STALE
  const [pid, host, started, held] = fields
  const id = Number(pid)
  if (host !== hostname()) return false
  if (boot !== '-' && held !== '-' && held !== boot) return true
  if (!Number.isSafeInteger(id) || id <= 0) return false
  if (id === process.pid) return started !== STARTED
  try {
    process.kill(id, 0)
    return false
  } catch (error) {
    return errorCode(error) === 'ESRCH'
  }
}
