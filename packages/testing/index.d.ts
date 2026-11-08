// Types of the fixture files. The schema is described in README.md; the
// JSON files are the source of truth.

export declare const FIXTURE_FORMAT: 'lazy-ease-fixtures'
export declare const FIXTURE_VERSION: 1

export type ImageFormat = 'avif' | 'webp' | 'jpeg'
/** A capability a case exercises beyond the base contract. */
export type Topic = 'nfc' | 'strict-q' | 'token' | 'url-parsing'

export interface FocalPoint {
  x: number
  y: number
}

/** Source dimensions as stored, before EXIF rotation. */
export interface StoredSource {
  width: number
  height: number
  /** EXIF orientation 1 to 8. 5 to 8 swap width and height. */
  orientation: number
}

export interface Case<Op extends string, Input, Expected> {
  /** Unique within the file, kebab-case, stable across releases. */
  id: string
  op: Op
  topics?: Topic[]
  note?: string
  input: Input
  expected: Expected
}

/** A case without an `op`, for files with a single operation. */
export type PlainCase<Input, Expected> = Omit<Case<never, Input, Expected>, 'op'>

export interface FixtureFile<Name extends string, C, Data = undefined> {
  format: 'lazy-ease-fixtures'
  fixtureVersion: 1
  contract: '0.3'
  file: Name
  description: string
  data: Data
  cases: C[]
}

export type RangeFailure = { error: 'range' }

export type LaddersCase =
  | Case<'snapWidth', { width: number; ladder?: number[] }, { width: number }>
  | Case<'snapRatio', { ratio: number; ladder?: number[] }, { ratio: number }>
  | Case<'snapQuality', { quality: number; allowed: number[] }, { quality: number }>

export interface LadderData {
  widths: number[]
  ratios: number[]
  qualities: number[]
  formats: ImageFormat[]
}

export type NumbersCase = Case<
  'formatNumber',
  { value: number } | { special: 'NaN' | 'Infinity' | '-Infinity' },
  { text: string } | RangeFailure
>

export type FocalCase = Case<'normalizeFocalPoint', FocalPoint, { focalPoint: FocalPoint | null }>

export interface CropWindow {
  left: number
  top: number
  width: number
  height: number
}

export type CropsCase = Case<
  'cropWindow',
  { srcWidth: number; srcHeight: number; aspectRatio: number; focalPoint: FocalPoint; stored?: StoredSource },
  CropWindow
>

export interface OutputSize {
  requestWidth: number
  width: number
  height: number
}

export type OutputsCase = Case<
  'outputSize',
  {
    srcWidth: number
    srcHeight: number
    width: number
    aspectRatio?: number
    focalPoint?: FocalPoint
    stored?: StoredSource
  },
  OutputSize | RangeFailure
>

export interface CandidatesInput {
  mode: 'measured' | 'fixed' | 'full'
  /** Measured box width or fixed `width` in CSS px; 0 for `full`. */
  slotWidth: number
  ladder?: number[]
  srcWidth?: number
  srcHeight?: number
  aspectRatio?: number
  focalPoint?: FocalPoint
}

export interface CandidatesExpected {
  requestWidths: number[]
  /** Null when either source dimension is unknown. */
  outputs: OutputSize[] | null
  /** Distinct outputs labeled with their encoded width; null when one URL suffices. */
  srcset: OutputSize[] | null
  /** The one URL to emit; width and height are null when the source size is unknown. */
  single: OutputSize | { requestWidth: number; width: null; height: null } | null
}

export type CandidatesCase = PlainCase<CandidatesInput, CandidatesExpected>

export interface UrlRequest {
  src: string
  width: number
  aspectRatio?: number
  quality: number
  format: ImageFormat
  version?: string
  focalPoint?: FocalPoint
  token?: string
}

export type UrlsCase =
  | Case<'encodePath', { src: string }, { path: string }>
  | Case<'url', { baseUrl?: string; request: UrlRequest }, { url: string }>

export interface BackendParams {
  width: number
  aspectRatio: number | null
  focalPoint: FocalPoint | null
  quality: number
  format: ImageFormat
  version: string | null
  token: string | null
}

export type BackendCase =
  | Case<'query', { query: string }, { status: 200; params: BackendParams } | { status: 400 }>
  | Case<
      'path',
      { rawPath: string },
      { status: 200; file: string; canonicalPath: string; canonical: boolean } | { status: 400 | 404 }
    >

export interface TokenGrant {
  tenant: string
  kid: string
  source: string
  revision?: string
  ar?: string
  fx?: string
  fy?: string
}

export interface TokenKey {
  tenant: string
  kid: string
  derivation: string
  keyHex: string
}

export interface TokenData {
  algorithm: string
  domain: string
  fieldOrder: ['tenant', 'kid', 'source', 'revision', 'ar', 'fx', 'fy']
  tokenPattern: string
  keys: TokenKey[]
  warning: string
}

export type TokensCase =
  | Case<
      'sign',
      { grant: TokenGrant; request?: Omit<UrlRequest, 'token'> },
      { messageHex: string; token: string; url?: string } | { error: 'invalid-input' }
    >
  | Case<
      'verify',
      {
        grant: Omit<TokenGrant, 'kid'>
        /**
         * The path as the request sent it, when it is not the canonical
         * `grant.source`. The verifier admits it like a backend path and
         * computes the MAC over its canonical path, which is `grant.source`.
         */
        rawPath?: string
        token: string
      },
      { valid: boolean }
    >

export interface Fixtures {
  ladders: FixtureFile<'ladders', LaddersCase, LadderData>
  numbers: FixtureFile<'numbers', NumbersCase>
  focal: FixtureFile<'focal', FocalCase>
  crops: FixtureFile<'crops', CropsCase>
  outputs: FixtureFile<'outputs', OutputsCase>
  candidates: FixtureFile<'candidates', CandidatesCase>
  urls: FixtureFile<'urls', UrlsCase>
  backend: FixtureFile<'backend', BackendCase>
  tokens: FixtureFile<'tokens', TokensCase, TokenData>
}

export type FixtureName = keyof Fixtures
type CaseOf<F extends FixtureName> = Fixtures[F]['cases'][number]
type OpOf<F extends FixtureName> = CaseOf<F> extends { op: infer O } ? O : never

export interface Manifest {
  format: 'lazy-ease-fixtures'
  fixtureVersion: 1
  contract: '0.3'
  files: { name: `${FixtureName}.json`; bytes: number; sha256: string; cases: number }[]
}

export declare const manifest: Manifest
export declare const fixtures: Fixtures

export interface SelectOptions {
  skipTopics?: readonly Topic[]
}

export declare function casesOf<F extends FixtureName, O extends OpOf<F> | undefined = undefined>(
  file: F,
  op?: O,
  options?: SelectOptions,
): O extends string ? Extract<CaseOf<F>, { op: O }>[] : CaseOf<F>[]

export declare function skippedCases<F extends FixtureName, O extends OpOf<F> | undefined = undefined>(
  file: F,
  op?: O,
  options?: SelectOptions,
): O extends string ? Extract<CaseOf<F>, { op: O }>[] : CaseOf<F>[]
