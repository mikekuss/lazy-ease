import { createHmac, timingSafeEqual } from 'node:crypto'
import { formatNumber } from '@lazy-ease/core'

// The optional crop token of the 0.3 contract. The byte format and the
// positive and negative vectors are in @lazy-ease/testing (tokens.json).

const DOMAIN = 'lazy-ease/crop-token/1'
export const TOKEN_PATTERN = /^1\.([A-Za-z0-9_-]{1,32})\.[A-Za-z0-9_-]{22}$/
export const TENANT_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/
const KID = /^[A-Za-z0-9_-]{1,32}$/
export const REVISION_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/
const PERCENT = /^(?:100|[1-9]?[0-9])$/

/** What a crop token covers, as the URL spells it. Width, format and quality are not part of it. */
export interface CropGrant {
  /** The deployment's namespace, from configuration, never from the request. */
  tenant: string
  /** `canonicalPath` of the source, e.g. `/my%20photos/caf%C3%A9.jpg`. */
  source: string
  /** The `v` value. Absent when the URL has no `v`. */
  revision?: string
  /** Canonical spellings as in the URL, absent when the URL omits them. */
  ar?: string
  fx?: string
  fy?: string
}

/** Key ids mapped to secret keys (at least 16 bytes) of one tenant. */
export type CropTokenKeys = Readonly<Record<string, Uint8Array>>

/** Whether `source` is the canonical encoded spelling of a source path. */
export function isCanonicalPath(source: string): boolean {
  if (!source.startsWith('/')) return false
  return source
    .slice(1)
    .split('/')
    .every((segment) => {
      if (segment === '') return false
      try {
        return encodeURIComponent(decodeURIComponent(segment).normalize('NFC')) === segment
      } catch {
        return false
      }
    })
}

function field(value: string | undefined): Buffer {
  if (value === undefined) return Buffer.from([0])
  const bytes = Buffer.from(value, 'utf8')
  const head = Buffer.alloc(5)
  head[0] = 1
  head.writeUInt32BE(bytes.length, 1)
  return Buffer.concat([head, bytes])
}

/**
 * The signed bytes for `grant` under key `kid`. Throws a `RangeError` for a
 * grant a URL could not carry: a focus without both coordinates or without
 * `ar`, the center written out, a non-canonical ratio or path, an empty
 * revision, a malformed tenant or key id.
 */
export function cropTokenMessage(grant: CropGrant, kid: string): Buffer {
  const { tenant, source, revision, ar, fx, fy } = grant
  if (!TENANT_PATTERN.test(tenant)) throw new RangeError('Invalid tenant')
  if (!KID.test(kid)) throw new RangeError('Invalid key id')
  if (!isCanonicalPath(source)) throw new RangeError('source must be a canonical path')
  if (revision !== undefined && !REVISION_PATTERN.test(revision)) throw new RangeError('Invalid revision')
  if (ar !== undefined && !(Number(ar) > 0 && formatNumber(Number(ar)) === ar)) throw new RangeError('ar must be a canonical ratio')
  if ((fx === undefined) !== (fy === undefined)) throw new RangeError('fx and fy go together')
  if (fx !== undefined && fy !== undefined) {
    if (ar === undefined) throw new RangeError('A focus needs ar')
    if (!PERCENT.test(fx) || !PERCENT.test(fy)) throw new RangeError('fx and fy are whole percent')
    if (fx === '50' && fy === '50') throw new RangeError('The center is absent, not 50/50')
  }
  return Buffer.concat([
    Buffer.from(DOMAIN, 'utf8'),
    Buffer.from([0]),
    ...[tenant, kid, source, revision, ar, fx, fy].map(field),
  ])
}

/**
 * Issues a crop token. Signing belongs on the backend (an upload hook or the
 * template renderer), never in browser code: the key is a secret.
 */
export function signCropToken(grant: CropGrant, kid: string, key: Uint8Array): string {
  if (key.byteLength < 16) throw new RangeError('A crop token key needs at least 16 bytes')
  const mac = createHmac('sha256', key).update(cropTokenMessage(grant, kid)).digest().subarray(0, 16)
  return `1.${kid}.${mac.toString('base64url')}`
}

/**
 * Whether `token` is valid for `grant`. An unknown key id, a malformed token or
 * a grant no URL can carry is invalid. The comparison of the two token strings
 * runs in constant time.
 */
export function verifyCropToken(grant: CropGrant, token: string, keys: CropTokenKeys): boolean {
  const match = TOKEN_PATTERN.exec(token)
  if (!match) return false
  const kid = match[1]!
  const key = Object.hasOwn(keys, kid) ? keys[kid] : undefined
  if (!key) return false
  let expected: string
  try {
    expected = signCropToken(grant, kid, key)
  } catch {
    return false
  }
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}
