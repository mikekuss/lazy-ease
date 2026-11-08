import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  FIXTURE_FORMAT,
  FIXTURE_VERSION,
  casesOf,
  fixtures,
  manifest,
  skippedCases,
  type FixtureName,
  type TokenGrant,
} from '@lazy-ease/testing'
import outputsJson from '@lazy-ease/testing/fixtures/outputs.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'

const fixtureDir = new URL('../fixtures/', import.meta.url)
const names = Object.keys(fixtures) as FixtureName[]

describe('fixture files', () => {
  it('lists every file in the manifest with its exact bytes', () => {
    expect(manifest.format).toBe(FIXTURE_FORMAT)
    expect(manifest.fixtureVersion).toBe(FIXTURE_VERSION)
    expect(manifest.files.map((f) => f.name)).toEqual(names.map((n) => `${n}.json`))
    for (const entry of manifest.files) {
      const bytes = readFileSync(new URL(entry.name, fixtureDir))
      expect(createHash('sha256').update(bytes).digest('hex'), entry.name).toBe(entry.sha256)
      expect(bytes.byteLength, entry.name).toBe(entry.bytes)
      expect(bytes.includes(0x0d), `${entry.name} has CR`).toBe(false)
      expect(fixtures[entry.name.replace(/\.json$/, '') as FixtureName].cases).toHaveLength(entry.cases)
    }
  })

  it('shares one envelope and unique kebab-case ids', () => {
    for (const name of names) {
      const doc = fixtures[name]
      expect(doc).toMatchObject({ format: FIXTURE_FORMAT, fixtureVersion: FIXTURE_VERSION, contract: '0.3', file: name })
      const ids = doc.cases.map((c) => c.id)
      expect(new Set(ids).size, name).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      for (const c of doc.cases) for (const topic of c.topics ?? []) expect(['nfc', 'safe-paths', 'strict-q', 'token', 'url-parsing']).toContain(topic)
    }
  })

  it('exports each JSON file under its own path', () => {
    expect(outputsJson).toEqual(fixtures.outputs)
  })

  it('selects cases by operation and topic', () => {
    const all = casesOf('urls')
    const urls = casesOf('urls', 'url')
    const withoutToken = casesOf('urls', 'url', { skipTopics: ['token'] })
    const token = skippedCases('urls', 'url', { skipTopics: ['token'] })
    expect(urls.every((c) => c.op === 'url')).toBe(true)
    expect(withoutToken.length + token.length).toBe(urls.length)
    expect(token.map((c) => c.id)).toEqual(['token'])
    expect(all.length).toBe(fixtures.urls.cases.length)
  })
})

// Worked by hand from the rules in README.md, so a regenerated fixture that
// drifts from the documented arithmetic fails here as well.
describe('hand-calculated cases', () => {
  const byId = <F extends FixtureName>(file: F, id: string) => {
    const found = fixtures[file].cases.find((c) => c.id === id)
    if (!found) throw new Error(`${file}/${id} is missing`)
    return found
  }

  it('encodes 10 x 5 when the target height rounds to 0', () => {
    // round(10 / 25) = 0, so no target height: 10 px wide, 1000 * 10 / 2000 = 5 high.
    expect(byId('outputs', 'height-rounds-to-zero-wide')).toMatchObject({
      input: { srcWidth: 2000, srcHeight: 1000, width: 10, aspectRatio: 25 },
      expected: { requestWidth: 10, width: 10, height: 5 },
    })
  })

  it('shrinks a 64 px request to the 3 x 10 window of an extreme crop', () => {
    // Window: round(10 * 0.25) = round(2.5) = 3 wide. Target 64 x 256;
    // scale = min(1, 3 / 64, 10 / 256) = 0.0390625; 64 * s = 2.5 -> 3, 256 * s = 10.
    expect(byId('outputs', 'extreme-tall-crop').expected).toEqual({ requestWidth: 64, width: 3, height: 10 })
    expect(byId('crops', 'extreme-tall-crop-right-edge').expected).toEqual({ left: 3997, top: 0, width: 3, height: 10 })
  })

  it('caps a square crop of a 1200 x 400 source at 400 px', () => {
    expect(byId('outputs', 'square-crop-capped-by-source').expected).toEqual({ requestWidth: 640, width: 400, height: 400 })
    // left = round(0.75 * 1200 - 200) = 700.
    expect(byId('crops', 'landscape-square-focus').expected).toEqual({ left: 700, top: 0, width: 400, height: 400 })
  })

  it('crops an EXIF-6 source in displayed coordinates', () => {
    // Stored 400 x 200, displayed 200 x 400. A bottom focus takes the lower square.
    expect(byId('crops', 'oriented-6-bottom')).toMatchObject({
      input: { srcWidth: 200, srcHeight: 400, stored: { width: 400, height: 200, orientation: 6 } },
      expected: { left: 0, top: 200, width: 200, height: 200 },
    })
    expect(byId('outputs', 'oriented-6-wide').expected).toEqual({ requestWidth: 384, width: 200, height: 100 })
  })

  it('rounds exact binary ties away from zero', () => {
    expect(byId('numbers', 'exact-tie-rounds-up').expected).toEqual({ text: '0.563' })
    expect(byId('numbers', 'negative-exact-tie-rounds-away').expected).toEqual({ text: '-1.063' })
    expect(byId('numbers', 'binary-below-half').expected).toEqual({ text: '1' })
  })

  it('collapses a 40 px avatar to one URL', () => {
    expect(byId('candidates', 'fixed-avatar-tiny-source').expected).toEqual({
      requestWidths: [64],
      outputs: [{ requestWidth: 64, width: 40, height: 40 }],
      srcset: null,
      single: { requestWidth: 64, width: 40, height: 40 },
    })
    expect(byId('candidates', 'unknown-metadata-measured').expected).toMatchObject({
      outputs: null,
      srcset: null,
      single: { requestWidth: 640, width: null, height: null },
    })
  })

  it('writes the documented example URLs', () => {
    expect(byId('urls', 'uncropped').expected).toEqual({ url: '/_img/lake.jpg?fmt=webp&q=75&w=640' })
    expect(byId('urls', 'focal').expected).toEqual({ url: '/_img/cliff.jpg?ar=1&fmt=webp&fx=30&fy=45&q=75&w=750' })
    expect(byId('urls', 'path-space-and-nfc').expected).toEqual({ path: '/my%20photos/caf%C3%A9.jpg' })
    expect(byId('urls', 'path-nfd-normalized').expected).toEqual({ path: '/my%20photos/caf%C3%A9.jpg' })
  })
})

// A second implementation of the token rules in README.md, independent of the
// Python checker that recomputes them too. Step 07 implements the real one.
describe('crop tokens', () => {
  const { data } = fixtures.tokens
  const keys = new Map(data.keys.map((k) => [`${k.tenant}/${k.kid}`, Buffer.from(k.keyHex, 'hex')]))
  const RATIOS = new Set(fixtures.ladders.data.ratios.map((r) => String(r)))
  const SAFE = /^[A-Za-z0-9._~-]{1,64}$/
  const PERCENT = /^(?:100|[1-9]?[0-9])$/

  function message(grant: TokenGrant): Buffer {
    const { tenant, kid, source, revision, ar, fx, fy } = grant
    // The source is the canonical encoded path: every segment survives a
    // decode, NFC and encode round trip unchanged.
    const canonicalSource =
      source.startsWith('/') &&
      source
        .slice(1)
        .split('/')
        .every((segment) => {
          try {
            return encodeURIComponent(decodeURIComponent(segment).normalize('NFC')) === segment
          } catch {
            return false
          }
        })
    const valid =
      SAFE.test(tenant) &&
      /^[A-Za-z0-9_-]{1,32}$/.test(kid) &&
      canonicalSource &&
      (revision === undefined || SAFE.test(revision)) &&
      (ar === undefined || RATIOS.has(ar)) &&
      (fx === undefined) === (fy === undefined) &&
      (fx === undefined || (ar !== undefined && PERCENT.test(fx) && PERCENT.test(fy!) && !(fx === '50' && fy === '50')))
    if (!valid) throw new Error('invalid-input')
    const parts = [Buffer.from(`${data.domain}\0`, 'utf8')]
    for (const value of [tenant, kid, source, revision, ar, fx, fy]) {
      if (value === undefined) {
        parts.push(Buffer.from([0]))
      } else {
        const bytes = Buffer.from(value, 'utf8')
        const length = Buffer.alloc(4)
        length.writeUInt32BE(bytes.length)
        parts.push(Buffer.from([1]), length, bytes)
      }
    }
    return Buffer.concat(parts)
  }

  const sign = (grant: TokenGrant, key: Buffer) =>
    `1.${grant.kid}.${createHmac('sha256', key).update(message(grant)).digest().subarray(0, 16).toString('base64url')}`

  /** The canonical path of a backend path: each segment decoded, NFC, encoded again. */
  const canonicalPath = (rawPath: string) =>
    rawPath
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment).normalize('NFC')))
      .join('/')

  function verify(grant: Omit<TokenGrant, 'kid'>, token: string, rawPath?: string): boolean {
    // The MAC covers the canonical path after path admission, never the
    // spelling the request used.
    if (rawPath !== undefined) grant = { ...grant, source: canonicalPath(rawPath) }
    const match = new RegExp(data.tokenPattern).exec(token)
    if (!match) return false
    const kid = token.split('.')[1]!
    const key = keys.get(`${grant.tenant}/${kid}`)
    if (!key) return false
    let expected: string
    try {
      expected = sign({ ...grant, kid }, key)
    } catch {
      return false
    }
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  }

  it('derives the public test keys from their labels', () => {
    for (const k of data.keys) {
      const label = `lazy-ease public test key/${k.tenant}/${k.kid}`
      expect(k.keyHex).toBe(createHash('sha256').update(label, 'utf8').digest('hex'))
    }
  })

  it('signs the exact bytes', () => {
    const cases = casesOf('tokens', 'sign')
    expect(cases.filter((c) => 'token' in c.expected).length).toBeGreaterThanOrEqual(8)
    for (const c of cases) {
      const { grant } = c.input
      if ('error' in c.expected) {
        expect(() => message(grant), c.id).toThrow('invalid-input')
        continue
      }
      expect(message(grant).toString('hex'), c.id).toBe(c.expected.messageHex)
      expect(sign(grant, keys.get(`${grant.tenant}/${grant.kid}`)!), c.id).toBe(c.expected.token)
    }
  })

  it('accepts and rejects the verification vectors', () => {
    const cases = casesOf('tokens', 'verify')
    expect(cases.filter((c) => !c.expected.valid).length).toBeGreaterThanOrEqual(15)
    for (const c of cases) expect(verify(c.input.grant, c.input.token, c.input.rawPath), c.id).toBe(c.expected.valid)
  })

  it('verifies a raw request path over its canonical spelling', () => {
    const raw = casesOf('tokens', 'verify').filter((c) => c.input.rawPath !== undefined)
    expect(raw.map((c) => c.id)).toEqual(['accept-raw-lowercase-hex', 'accept-raw-nfd', 'accept-raw-overencoded'])
    for (const c of raw) {
      expect(c.input.rawPath, c.id).not.toBe(c.input.grant.source)
      expect(canonicalPath(c.input.rawPath!), c.id).toBe(c.input.grant.source)
      expect(c.expected.valid, c.id).toBe(true)
      // Signing the raw spelling is refused, so a verifier must canonicalize first.
      expect(() => message({ ...c.input.grant, kid: 'k1', source: c.input.rawPath! }), c.id).toThrow('invalid-input')
    }
  })
})
