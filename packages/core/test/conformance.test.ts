import { casesOf, fixtures, skippedCases, type FocalPoint, type OutputSize, type Topic } from '@lazy-ease/testing'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RATIOS,
  DEFAULT_WIDTHS,
  buildSrcSet,
  candidateSet,
  classicCandidates,
  createLoader,
  cropWindow,
  encodePath,
  formatNumber,
  fullLadder,
  measuredCandidates,
  normalizeFocalPoint,
  outputSize,
  snapQuality,
  snapRatio,
  snapWidth,
} from '../src/index.js'

// The portable fixtures from @lazy-ease/testing, run against core. The
// server runs the same records in packages/server/test/conformance.test.ts.

// Topics core does not implement yet. Their cases are checked to still fail
// below, so implementing one makes that test fail until it moves here.
const PENDING: Topic[] = [
  'nfc', // encodePath does not NFC-normalize input; the fix costs more than the React Image budget allows
  'safe-paths', // stray %, non-UTF-8 escapes and other schemes: step 06, once React Image is off the 7557 B ceiling
]

describe('ladders', () => {
  it('has the default sets', () => {
    expect(DEFAULT_WIDTHS).toEqual(fixtures.ladders.data.widths)
    expect(DEFAULT_RATIOS).toEqual(fixtures.ladders.data.ratios)
    expect(createLoader().qualities).toEqual(fixtures.ladders.data.qualities)
    expect(createLoader().formats).toEqual(fixtures.ladders.data.formats)
  })

  it.each(casesOf('ladders', 'snapWidth'))('snapWidth $id', ({ input, expected }) => {
    expect(snapWidth(input.width, input.ladder)).toBe(expected.width)
  })
  it.each(casesOf('ladders', 'snapRatio'))('snapRatio $id', ({ input, expected }) => {
    expect(snapRatio(input.ratio, input.ladder)).toBe(expected.ratio)
  })
  it.each(casesOf('ladders', 'snapQuality'))('snapQuality $id', ({ input, expected }) => {
    expect(snapQuality(input.quality, input.allowed)).toBe(expected.quality)
  })
})

describe('numbers', () => {
  const SPECIAL = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY }
  it.each(casesOf('numbers', 'formatNumber'))('$id', ({ input, expected }) => {
    const value = 'special' in input ? SPECIAL[input.special] : input.value
    if ('error' in expected) expect(() => formatNumber(value)).toThrow(RangeError)
    else expect(formatNumber(value)).toBe(expected.text)
  })
})

describe('focal points', () => {
  it.each(casesOf('focal', 'normalizeFocalPoint'))('$id', ({ input, expected }) => {
    expect(normalizeFocalPoint(input) ?? null).toEqual(expected.focalPoint)
  })
})

describe('crop windows', () => {
  it.each(casesOf('crops', 'cropWindow'))('$id', ({ input, expected }) => {
    expect(cropWindow(input.srcWidth, input.srcHeight, input.aspectRatio, input.focalPoint)).toEqual(expected)
  })
})

describe('output sizes', () => {
  it.each(casesOf('outputs', 'outputSize'))('$id', ({ input, expected }) => {
    const run = () => outputSize(input.srcWidth, input.srcHeight, input)
    if ('error' in expected) expect(run).toThrow(RangeError)
    else expect(run()).toEqual(expected)
  })
})

describe('candidates', () => {
  it.each(casesOf('candidates'))('$id', ({ input, expected }) => {
    const ladder = input.ladder ?? DEFAULT_WIDTHS
    const { srcWidth, srcHeight, aspectRatio, focalPoint } = input
    const requestWidths =
      input.mode === 'measured'
        ? measuredCandidates({ measuredWidth: input.slotWidth, ladder, srcWidth })
        : input.mode === 'fixed'
          ? classicCandidates({ width: input.slotWidth, ladder, srcWidth })
          : fullLadder({ ladder, srcWidth })
    expect(requestWidths).toEqual(expected.requestWidths)

    if (srcWidth === undefined || srcHeight === undefined) {
      expect(expected).toMatchObject({ outputs: null, srcset: null })
      expect(expected.single).toEqual({ requestWidth: Math.max(...requestWidths), width: null, height: null })
      return
    }
    const outputs = requestWidths.map((width) => outputSize(srcWidth, srcHeight, { width, aspectRatio, focalPoint }))
    expect(outputs).toEqual(expected.outputs)
    const distinct: OutputSize[] = []
    for (const o of outputs) if (!distinct.some((d) => d.width === o.width && d.height === o.height)) distinct.push(o)
    expect(distinct.length === 1 ? null : distinct).toEqual(expected.srcset)
    expect(distinct.length === 1 ? distinct[0] : null).toEqual(expected.single)
  })

  // candidateSet is what the controller installs: the srcset labeled with
  // encoded widths and deduplicated, a single URL when one output remains,
  // and the largest request alone when the source size is unknown.
  it.each(casesOf('candidates'))('candidateSet $id', ({ input, expected }) => {
    const loader = createLoader()
    const request = { src: '/x.jpg', quality: 75, format: 'webp' as const, aspectRatio: input.aspectRatio, focalPoint: input.focalPoint }
    const url = (width: number) => loader.url({ ...request, width })
    const set = candidateSet({ ...request, widths: expected.requestWidths, srcWidth: input.srcWidth, srcHeight: input.srcHeight, loader })
    expect(set.srcset ?? null).toBe(expected.srcset?.map((o) => `${url(o.requestWidth)} ${o.width}w`).join(', ') ?? null)
    if (expected.single) expect(set.src).toBe(url(expected.single.requestWidth))
    else expect(set.src).toBe(url(expected.srcset!.at(-1)!.requestWidth))
  })

  it('covers the unknown-metadata rule', () => {
    const unknown = casesOf('candidates').filter((c) => c.expected.outputs === null)
    expect(unknown.length).toBeGreaterThan(0)
    for (const { expected } of unknown) expect(expected.single).toMatchObject({ width: null, height: null })
  })

  // React still builds its srcset with buildSrcSet (request-width labels, no
  // merging) until it moves to the controller in step 06.
  it('keeps the 0.2 buildSrcSet labels for React', () => {
    const loader = createLoader()
    const srcset = buildSrcSet({ src: '/x.jpg', widths: [640, 64], quality: 75, format: 'webp', loader })
    expect(srcset).toBe('/_img/x.jpg?fmt=webp&q=75&w=64 64w, /_img/x.jpg?fmt=webp&q=75&w=640 640w')
  })
})

describe('urls', () => {
  const skipTopics = PENDING

  it.each(casesOf('urls', 'encodePath', { skipTopics }))('encodePath $id', ({ input, expected }) => {
    if ('error' in expected) expect(() => encodePath(input.src)).toThrow(RangeError)
    else expect(encodePath(input.src)).toBe(expected.path)
  })

  it.each(casesOf('urls', 'url', { skipTopics }))('url $id', ({ input, expected }) => {
    const loader = createLoader(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl })
    const { focalPoint, ...request } = input.request
    // The loader receives a focal point that is already normalized.
    expect(normalizeFocalPoint(focalPoint)).toEqual(focalPoint)
    const url = () => loader.url({ ...request, focalPoint: focalPoint as FocalPoint | undefined })
    if ('error' in expected) expect(url).toThrow(RangeError)
    else expect(url()).toBe(expected.url)
  })

  it('still fails the pending topics', () => {
    const pending = [...skippedCases('urls', 'encodePath', { skipTopics }), ...skippedCases('urls', 'url', { skipTopics })]
    expect(pending.map((c) => c.id).sort()).toEqual([
      'nfd-source',
      'non-http-source',
      'path-data-url',
      'path-drive-letter',
      'path-ftp-url',
      'path-invalid-utf8',
      'path-invalid-utf8-keeps-escapes',
      'path-invalid-utf8-own-segment',
      'path-invalid-utf8-stray-percent',
      'path-nfd-normalized',
      'path-overlong-utf8',
      'path-pre-encoded-nfd',
      'path-scheme-absolute-path',
      'path-scheme-relative-name',
      'path-stray-percent-escaped',
      'path-stray-percent-non-ascii',
      'path-stray-percent-space',
      'stray-percent-source',
    ])
    for (const c of pending) {
      // Core returns a different path or URL, also where the record expects an error.
      const actual = c.op === 'encodePath' ? encodePath(c.input.src) : createLoader().url(c.input.request)
      const wanted = 'path' in c.expected ? c.expected.path : 'url' in c.expected ? c.expected.url : undefined
      expect(actual, c.id).not.toBe(wanted)
    }
  })
})
