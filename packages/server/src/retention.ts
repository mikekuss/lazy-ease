/**
 * Which stored variants to keep: recency under a hard byte cap, a per-source
 * byte quota, an entry cap and cold expiration, with optional promotion of a
 * source's most used variants. Pure accounting: the storage does the I/O.
 */

export interface PromoteOptions {
  /** Uses within one window that promote a variant. Default 3. */
  hits?: number
  /** Length of the counting window in ms. Default 1 hour. */
  window?: number
  /** Promoted variants per source at most. Default 8. */
  perSource?: number
}

export interface RetentionOptions {
  /** Hard cap on stored bytes. 0 stores nothing. */
  maxBytes?: number
  /** Stored variants at most, which bounds the in-memory index. */
  maxEntries?: number
  /** Bytes one source's variants may take, promoted ones included. Default `maxBytes / 8`. */
  maxSourceBytes?: number
  /** A variant unused for this many ms expires, promoted or not. Default 30 days. */
  maxAge?: number
  /**
   * Keep each source's most used variants longer: a variant used `hits`
   * times within `window` is promoted, up to `perSource` per source.
   * Promoted variants take at most 80% of `maxBytes` and are evicted after
   * the others; past that share, at the hard limit, they go first. Off by
   * default; `true` uses the defaults.
   */
  promote?: PromoteOptions | boolean
}

export interface Limits {
  maxBytes: number
  maxEntries: number
  maxSourceBytes: number
  maxAge: number
  promote: Required<PromoteOptions> | undefined
}

export interface Entry {
  key: string
  source: string
  bytes: number
  /** Last use, ms. */
  at: number
  /** Uses in the current window and when that window started. */
  hits: number
  since: number
  promoted: boolean
}

const DAY = 24 * 60 * 60 * 1000
/** Share of `maxBytes` (and of `maxSourceBytes`) promoted variants may hold. */
export const PROMOTED_SHARE = 0.8
/** Expiration scans the whole index at most this often. */
const EXPIRE_INTERVAL = 60_000

export function resolveLimits(options: RetentionOptions, defaults: { maxBytes: number; maxEntries: number }): Limits {
  const maxBytes = options.maxBytes ?? defaults.maxBytes
  const maxEntries = options.maxEntries ?? defaults.maxEntries
  const maxSourceBytes = options.maxSourceBytes ?? Math.floor(maxBytes / 8)
  const maxAge = options.maxAge ?? 30 * DAY
  for (const [name, value] of Object.entries({ maxBytes, maxEntries, maxSourceBytes, maxAge })) {
    if (!(Number.isSafeInteger(value) && value >= 0)) throw new RangeError(`${name} must be a non-negative integer`)
  }
  const given = options.promote === true ? {} : options.promote || undefined
  const promote = given && { hits: given.hits ?? 3, window: given.window ?? 60 * 60 * 1000, perSource: given.perSource ?? 8 }
  if (promote) {
    for (const [name, value] of Object.entries(promote)) {
      if (!(Number.isSafeInteger(value) && value >= 1)) throw new RangeError(`promote.${name} must be a positive integer`)
    }
  }
  return { maxBytes, maxEntries, maxSourceBytes, maxAge, promote }
}

interface Group {
  bytes: number
  promotedBytes: number
  /** Least recently used first, like the global lists. */
  cold: Map<string, Entry>
  hot: Map<string, Entry>
}

export class Retention {
  readonly limits: Limits
  bytes = 0
  promotedBytes = 0
  private readonly cold = new Map<string, Entry>()
  private readonly hot = new Map<string, Entry>()
  private readonly groups = new Map<string, Group>()
  private expiredAt = 0

  constructor(limits: Limits) {
    this.limits = limits
  }

  get size(): number {
    return this.cold.size + this.hot.size
  }

  get(key: string): Entry | undefined {
    return this.cold.get(key) ?? this.hot.get(key)
  }

  /** Whether a variant of this size may be stored at all. */
  fits(bytes: number): boolean {
    return this.limits.maxEntries > 0 && bytes <= this.limits.maxBytes && bytes <= this.limits.maxSourceBytes
  }

  /**
   * Records a stored variant that `fits()` (`at` is its last use) and
   * returns the entries evicted to make room, which may include the new one.
   * A key that is already present is replaced, so it is never counted twice.
   */
  add(key: string, source: string, bytes: number, at: number, now: number): Entry[] {
    this.remove(key)
    this.link({ key, source, bytes, at, hits: 0, since: at, promoted: false })
    return [...this.expire(now), ...this.enforce(source)]
  }

  /** A use of `key`: recency and popularity. Returns entries that expired meanwhile. */
  touch(key: string, now: number): Entry[] {
    const entry = this.get(key)
    if (!entry) return []
    this.unlink(entry)
    entry.at = Math.max(entry.at, now)
    const promote = this.limits.promote
    if (promote) {
      if (now - entry.since >= promote.window) {
        entry.since = now
        entry.hits = 0
      }
      entry.hits++
      if (!entry.promoted && entry.hits >= promote.hits) entry.promoted = true
    }
    this.link(entry)
    const evicted: Entry[] = []
    if (entry.promoted && promote) {
      // Top-K per source: the least recently used promoted variant steps down.
      const group = this.groups.get(entry.source)!
      while (group.hot.size > promote.perSource) this.demote(group.hot.values().next().value!)
      evicted.push(...this.enforce(entry.source))
    }
    evicted.push(...this.expire(now))
    return evicted
  }

  /** Forgets `key` and returns its entry. */
  remove(key: string): Entry | undefined {
    const entry = this.get(key)
    if (entry) this.unlink(entry)
    return entry
  }

  /** Forgets every entry. */
  clear(): void {
    this.cold.clear()
    this.hot.clear()
    this.groups.clear()
    this.bytes = 0
    this.promotedBytes = 0
  }

  /**
   * Drops variants unused for `maxAge` and demotes promoted ones that missed
   * a whole window. Scans at most once a minute unless `force`.
   */
  expire(now: number, force = false): Entry[] {
    if (!force && now - this.expiredAt < EXPIRE_INTERVAL) return []
    this.expiredAt = now
    const evicted: Entry[] = []
    for (const entry of [...this.cold.values(), ...this.hot.values()]) {
      if (now - entry.at > this.limits.maxAge) {
        this.unlink(entry)
        evicted.push(entry)
      } else if (entry.promoted && this.limits.promote && now - entry.since >= 2 * this.limits.promote.window) {
        this.demote(entry)
      }
    }
    return evicted
  }

  /** Evicts until every limit holds again, e.g. after limits were lowered between runs. */
  enforce(source?: string): Entry[] {
    const evicted: Entry[] = []
    const one = source === undefined ? undefined : this.groups.get(source)
    const groups = source === undefined ? [...this.groups.values()] : one ? [one] : []
    for (const group of groups) {
      while (group.bytes > this.limits.maxSourceBytes) {
        evicted.push(this.evictFrom(group.cold, group.hot, group.promotedBytes > PROMOTED_SHARE * this.limits.maxSourceBytes))
      }
    }
    while (this.bytes > this.limits.maxBytes || this.size > this.limits.maxEntries) {
      evicted.push(this.evictFrom(this.cold, this.hot, this.promotedBytes > PROMOTED_SHARE * this.limits.maxBytes))
    }
    return evicted
  }

  /** Least recently used first; promoted ones only when nothing else is left or their share is exceeded. */
  private evictFrom(cold: Map<string, Entry>, hot: Map<string, Entry>, hotFirst: boolean): Entry {
    const first = hotFirst && hot.size > 0 ? hot : cold.size > 0 ? cold : hot
    const entry = first.values().next().value!
    this.unlink(entry)
    return entry
  }

  /**
   * A demoted variant re-enters the cold list as its most recent entry,
   * whatever its last use: it outlives cold variants used after it until it
   * is the oldest again. At most `perSource` per source are affected.
   */
  private demote(entry: Entry) {
    this.unlink(entry)
    entry.promoted = false
    entry.hits = 0
    this.link(entry)
  }

  private link(entry: Entry) {
    let group = this.groups.get(entry.source)
    if (!group) {
      group = { bytes: 0, promotedBytes: 0, cold: new Map(), hot: new Map() }
      this.groups.set(entry.source, group)
    }
    ;(entry.promoted ? this.hot : this.cold).set(entry.key, entry)
    ;(entry.promoted ? group.hot : group.cold).set(entry.key, entry)
    this.bytes += entry.bytes
    group.bytes += entry.bytes
    if (entry.promoted) {
      this.promotedBytes += entry.bytes
      group.promotedBytes += entry.bytes
    }
  }

  private unlink(entry: Entry) {
    const group = this.groups.get(entry.source)!
    ;(entry.promoted ? this.hot : this.cold).delete(entry.key)
    ;(entry.promoted ? group.hot : group.cold).delete(entry.key)
    this.bytes -= entry.bytes
    group.bytes -= entry.bytes
    if (entry.promoted) {
      this.promotedBytes -= entry.bytes
      group.promotedBytes -= entry.bytes
    }
    if (group.cold.size === 0 && group.hot.size === 0) this.groups.delete(entry.source)
  }
}
