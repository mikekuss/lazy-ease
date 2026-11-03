import { formatNumber } from './numbers.js'
import { DEFAULT_RATIOS } from './ratios.js'
import { DEFAULT_WIDTHS } from './widths.js'

export type ImageFormat = 'avif' | 'webp' | 'jpeg'

/** What the component asks the loader for (spec 6.1). */
export interface ImageRequest {
  src: string
  /** Always a value of the loader's width ladder. */
  width: number
  /** Always a value of the ratio ladder. Absent when there is no crop. */
  aspectRatio?: number
  /** Always one of the loader's qualities. */
  quality: number
  /** `'auto'` only for loaders that declare `formats: 'auto'`. */
  format: ImageFormat | 'auto'
  /** The `version` prop, opaque. */
  version?: string
  /** Backend-specific passthrough from the provider. */
  params?: Record<string, string>
}

/**
 * Turns an image request into a URL and declares what the backend can render.
 * The only coupling between component and backend.
 */
export interface ImageLoader {
  url(request: ImageRequest): string
  /** The width ladder. */
  widths: readonly number[]
  /** The ratio ladder. Defaults to `DEFAULT_RATIOS`. */
  ratios?: readonly number[]
  qualities: readonly number[]
  /** `'auto'` for backends that negotiate the format through `Accept`; skips detection. */
  formats: readonly ImageFormat[] | 'auto'
}

/** The function shorthand for a loader. Gets the default ladders. */
export type ImageLoaderFunction = (request: ImageRequest) => string

/** A loader with every capability filled in. */
export type ResolvedLoader = ImageLoader & { ratios: readonly number[] }

const DEFAULT_QUALITIES: readonly number[] = [75]
const DEFAULT_FORMATS: readonly ImageFormat[] = ['avif', 'webp', 'jpeg']

// Same function, same object, so the result is stable as a React dependency.
const normalized = new WeakMap<object, ResolvedLoader>()

/** Turns the function shorthand into a loader object and fills in the ratio ladder. */
export function normalizeLoader(loader: ImageLoader | ImageLoaderFunction): ResolvedLoader {
  let resolved = normalized.get(loader)
  if (resolved) return resolved
  resolved =
    typeof loader === 'function'
      ? {
          url: loader,
          widths: DEFAULT_WIDTHS,
          ratios: DEFAULT_RATIOS,
          qualities: DEFAULT_QUALITIES,
          formats: DEFAULT_FORMATS,
        }
      : { ...loader, ratios: loader.ratios ?? DEFAULT_RATIOS }
  normalized.set(loader, resolved)
  return resolved
}

/** Nearest allowed quality. An exact tie goes to the higher one. */
export function snapQuality(quality: number, allowed: readonly number[]): number {
  let best: number | undefined
  for (const q of allowed) {
    if (best === undefined) best = q
    const d = Math.abs(q - quality)
    const bestD = Math.abs(best - quality)
    if (d < bestD || (d === bestD && q > best)) best = q
  }
  if (best === undefined) throw new RangeError('The loader allows no qualities')
  return best
}

export interface LoaderOptions {
  /** Where @lazy-ease/server is mounted. Defaults to `/_img`. */
  baseUrl?: string
  widths?: readonly number[]
  ratios?: readonly number[]
  qualities?: readonly number[]
  /** Extra query parameters added to every URL, sorted in with the others. */
  params?: Record<string, string | number>
}

// Any absolute URL resolves against this unchanged; a path resolves onto it.
const DUMMY_BASE = 'http://lazy-ease.invalid'

/**
 * The URL path of `src`, each segment `encodeURIComponent`-encoded. An
 * absolute URL loses its origin (spec 10: `domains` serve the same files as
 * the root); query, hash and dot segments are dropped.
 */
function encodePath(src: string): string {
  const { pathname } = new URL(src, DUMMY_BASE)
  return pathname
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment))
      } catch {
        // A stray `%` the URL parser left alone.
        return encodeURIComponent(segment)
      }
    })
    .join('/')
}

/**
 * Loader for the reference backend. Emits the canonical URL from spec 6.1:
 * `{baseUrl}/{path}?ar=…&fmt=…&q=…&v=…&w=…`, parameters sorted, absent ones
 * omitted, numbers in canonical form.
 */
export function createLoader({
  baseUrl = '/_img',
  widths = DEFAULT_WIDTHS,
  ratios = DEFAULT_RATIOS,
  qualities = DEFAULT_QUALITIES,
  params = {},
}: LoaderOptions = {}): ResolvedLoader {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    widths,
    ratios,
    qualities,
    formats: DEFAULT_FORMATS,
    url: ({ src, width, aspectRatio, quality, format, version, params: requestParams }) => {
      const extra = Object.entries({ ...params, ...requestParams }).map(([key, value]) => [key.toLowerCase(), value])
      const values: Record<string, string | number | undefined> = {
        ...Object.fromEntries(extra),
        // The contract's own parameters win over a passthrough of the same name.
        ar: aspectRatio,
        fmt: format,
        q: quality,
        v: version || undefined,
        w: width,
      }
      const query = Object.keys(values)
        .sort()
        .flatMap((key) => {
          const value = values[key]
          if (value === undefined) return []
          const text = typeof value === 'number' ? formatNumber(value) : value
          return `${encodeURIComponent(key)}=${encodeURIComponent(text)}`
        })
        .join('&')
      return `${base}${encodePath(src)}?${query}`
    },
  }
}
