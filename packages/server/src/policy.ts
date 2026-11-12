import { createHash } from 'node:crypto'
import { formatNumber, normalizeFocalPoint, type FocalPoint } from '@lazy-ease/core'
import type { ImageParams } from './contract.js'
import type { Source } from './source.js'

/** A crop a source admits without a token. `{}` is the uncropped image. */
export interface Crop {
  /** A ratio of the configured ladder. Absent: uncropped. */
  aspectRatio?: number
  /** Only with `aspectRatio`. Absent or the center: a centered crop. */
  focalPoint?: FocalPoint
}

/** What the deployment allows for one source, typically from its upload record. */
export interface SourcePolicy {
  /**
   * The current revision of the source's bytes, as templates write it into
   * `v`. A request whose `v` names another revision is a 404. A `v` equal to it
   * makes the response immutable; a request without `v` revalidates.
   * Default: `contentRevision` of the file, which `computeMetadata` returns too.
   * A revision of your own must change whenever the bytes change.
   */
  revision?: string
  /**
   * The source's recorded focal point. With the default `crops`, every ladder
   * ratio is admitted centered on it. A focus elsewhere needs a crop token.
   */
  focalPoint?: FocalPoint
  /**
   * The crops admitted without a token: a finite list, which must contain
   * `{}` to admit the uncropped image. Default: uncropped plus every ratio of
   * the ladder at `focalPoint`. A crop token admits any crop it covers.
   */
  crops?: readonly Crop[]
  /**
   * Private sources are served only after `authorize` accepts the request,
   * cache hits and 304s included, with `Cache-Control: private`.
   */
  private?: boolean
}

export interface SourceRef {
  /** The deployment's namespace (`tenant` option). */
  tenant: string
  /** Canonical encoded path, e.g. `/my%20photos/caf%C3%A9.jpg`. */
  path: string
}

const sameFocus = (a: FocalPoint | undefined, b: FocalPoint | undefined) => (a === undefined ? b === undefined : b !== undefined && a.x === b.x && a.y === b.y)

/**
 * Whether the policy admits the crop of `params` without a token. Policy
 * values are normalized the way the URL spells them: ratios by canonical
 * spelling, focal points to whole percent with the center absent.
 */
export function admitsCrop(policy: SourcePolicy, params: ImageParams, ratios: readonly number[]): boolean {
  const { aspectRatio, focalPoint } = params
  if (policy.crops === undefined) {
    if (aspectRatio === undefined) return true
    return sameFocus(normalizeFocalPoint(policy.focalPoint), focalPoint)
  }
  return policy.crops.some((crop) => {
    if (crop.aspectRatio === undefined) {
      if (crop.focalPoint !== undefined) throw new TypeError('A crop with a focal point needs an aspectRatio')
      return aspectRatio === undefined
    }
    const spelled = formatNumber(crop.aspectRatio)
    if (!ratios.some((r) => formatNumber(r) === spelled)) throw new TypeError(`Crop ratio ${spelled} is not on the ratio ladder`)
    return aspectRatio !== undefined && formatNumber(aspectRatio) === spelled && sameFocus(normalizeFocalPoint(crop.focalPoint), focalPoint)
  })
}

/** The 22-character base64url SHA-256 prefix of the bytes: a revision that changes with them. */
export function revisionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest().subarray(0, 16).toString('base64url')
}

export interface ContentRevisions {
  /** The remembered revision of the file at this real path, size and mtime. */
  get(source: Source): string | undefined
  set(source: Source, revision: string): void
  delete(source: Source): void
}

/**
 * Content revisions memoized by real path, size and mtime in a bounded map,
 * so a warm request does not read the file again. A rewrite that keeps the
 * size and the mtime is not noticed here: a render job that reads other bytes
 * drops the entry, and a `v` that misses it triggers one bounded rehash.
 */
export function createContentRevisions(limit = 1024): ContentRevisions {
  const known = new Map<string, string>()
  const keyOf = (source: Source) => `${source.file}\0${source.size}\0${source.mtimeMs}`
  return {
    get(source) {
      const key = keyOf(source)
      const revision = known.get(key)
      if (revision !== undefined) {
        known.delete(key)
        known.set(key, revision)
      }
      return revision
    },
    set(source, revision) {
      const key = keyOf(source)
      known.delete(key)
      known.set(key, revision)
      while (known.size > limit) known.delete(known.keys().next().value!)
    },
    delete(source) {
      known.delete(keyOf(source))
    },
  }
}
