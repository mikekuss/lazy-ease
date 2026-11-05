import { HTTPException } from 'hono/http-exception'

/**
 * Widths the backend renders (spec 3). Must match `DEFAULT_WIDTHS` in the
 * `@lazy-ease/react` package; the server does not import it.
 */
export const DEFAULT_WIDTHS: readonly number[] = [
  64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840,
]

export const DEFAULT_QUALITIES: readonly number[] = [75]

export type OutputFormat = 'avif' | 'webp' | 'jpeg'
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['avif', 'webp', 'jpeg']

/**
 * Canonical form for every number in an image URL (spec 6.1): at most 3
 * decimals, no trailing zeros, no exponent. Same rule as the client.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Cannot format ${n} for a URL`)
  if (Math.abs(n) >= 1e21) return BigInt(n).toString()
  return String(Number(n.toFixed(3)))
}

const round = (x: number) => Number(x.toFixed(3))

function buildRatios(): number[] {
  const ratios = new Set<number>()
  // 2^(k/16) for k = -32 … 32: 65 log-spaced values from 0.25 to 4.
  for (let k = -32; k <= 32; k++) ratios.add(round(2 ** (k / 16)))
  // 4:3, 3:2, 16:9, 21:9 and their inverses.
  for (const r of [4 / 3, 3 / 2, 16 / 9, 21 / 9]) {
    ratios.add(round(r))
    ratios.add(round(1 / r))
  }
  return [...ratios].sort((a, b) => a - b)
}

/** Crop ratios the backend renders (spec 6.1), 73 values from 0.25 to 4. */
export const DEFAULT_RATIOS: readonly number[] = buildRatios()

/** A point in the source, in whole percent of its width and height. */
export interface FocalPoint {
  x: number
  y: number
}

export interface ImageParams {
  width: number
  /** Absent when there is no crop. */
  aspectRatio?: number
  /** Absent for the center. Only with `aspectRatio`. */
  focalPoint?: FocalPoint
  quality: number
  format: OutputFormat
  version?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export interface CropWindow {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The part of a `width × height` source that a crop to `ratio` keeps (spec
 * 12.1): the largest window of that ratio, placed so the focal point is as
 * close to its center as the source edges allow. Whole pixels. Must match
 * `cropWindow` in `@lazy-ease/react`.
 */
export function cropWindow(width: number, height: number, ratio: number, focus: FocalPoint): CropWindow {
  if (width / height > ratio) {
    const w = clamp(Math.round(height * ratio), 1, width)
    const left = clamp(Math.round((focus.x / 100) * width - w / 2), 0, width - w)
    return { left, top: 0, width: w, height }
  }
  const h = clamp(Math.round(width / ratio), 1, height)
  const top = clamp(Math.round((focus.y / 100) * height - h / 2), 0, height - h)
  return { left: 0, top, width, height: h }
}

export interface Ladders {
  widths: readonly number[]
  ratios: readonly number[]
  qualities: readonly number[]
}

const PARAM_NAMES = new Set(['ar', 'fmt', 'fx', 'fy', 'q', 'v', 'w'])
// Whole percent, 0 to 100, no leading zeros.
const PERCENT = /^(?:100|[1-9]?[0-9])$/
// RFC 3986 unreserved characters, which encodeURIComponent leaves alone.
const VERSION = /^[A-Za-z0-9._~-]{1,64}$/

const invalid = (message: string) => new HTTPException(400, { message })

/** The ladder value whose canonical spelling is exactly `raw`. */
function canonical(raw: string, allowed: readonly number[]): number | undefined {
  return allowed.find((n) => formatNumber(n) === raw)
}

/**
 * Parses the raw query string of an image request (spec 12.1). Only the
 * canonical spelling is accepted: known parameters in alphabetical order, once
 * each, values exactly as the default loader writes them. Anything else is a
 * 400, so a CDN keying on the raw query string sees one URL per variant.
 */
export function parseImageQuery(raw: string, { widths, ratios, qualities }: Ladders): ImageParams {
  const values = new Map<string, string>()
  let previous = ''
  for (const part of raw === '' ? [] : raw.split('&')) {
    const eq = part.indexOf('=')
    const name = eq === -1 ? part : part.slice(0, eq)
    if (!PARAM_NAMES.has(name)) throw invalid('Unknown parameter')
    if (eq === -1) throw invalid(`Missing value for ${name}`)
    if (name === previous) throw invalid(`Duplicate ${name}`)
    if (name < previous) throw invalid('Parameters must be in alphabetical order')
    previous = name
    values.set(name, part.slice(eq + 1))
  }

  const w = values.get('w')
  if (w === undefined) throw invalid('Missing w')
  const width = canonical(w, widths)
  if (width === undefined) throw invalid('w must be a ladder width in canonical form')

  const fmt = values.get('fmt')
  if (fmt === undefined) throw invalid('Missing fmt')
  if (!(OUTPUT_FORMATS as readonly string[]).includes(fmt)) throw invalid('fmt must be avif, webp or jpeg')

  const params: ImageParams = { width, quality: qualities[0]!, format: fmt as OutputFormat }

  const ar = values.get('ar')
  if (ar !== undefined) {
    const aspectRatio = canonical(ar, ratios)
    if (aspectRatio === undefined) throw invalid('ar must be a ladder ratio in canonical form')
    params.aspectRatio = aspectRatio
  }

  const fx = values.get('fx')
  const fy = values.get('fy')
  if (fx !== undefined || fy !== undefined) {
    if (fx === undefined || fy === undefined) throw invalid('fx and fy must be given together')
    if (params.aspectRatio === undefined) throw invalid('fx and fy require ar')
    if (!PERCENT.test(fx) || !PERCENT.test(fy)) throw invalid('fx and fy must be whole numbers from 0 to 100')
    if (fx === '50' && fy === '50') throw invalid('The center is the default; omit fx and fy')
    params.focalPoint = { x: Number(fx), y: Number(fy) }
  }

  const q = values.get('q')
  if (q !== undefined) {
    const quality = canonical(q, qualities)
    if (quality === undefined) throw invalid('q must be an allowed quality in canonical form')
    params.quality = quality
  }

  const v = values.get('v')
  if (v !== undefined) {
    if (!VERSION.test(v)) throw invalid('v must be 1 to 64 URL-safe characters')
    params.version = v
  }

  return params
}
