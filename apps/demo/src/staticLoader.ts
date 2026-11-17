import { DEFAULT_RATIOS, DEFAULT_WIDTHS, encodePath, formatNumber, type ImageFormat, type ImageLoader, type ImageRequest } from '@lazy-ease/react'

/**
 * A custom loader for a static host (spec 6.1). GitHub Pages ignores query
 * strings, so every variant is a file of its own, rendered at build time:
 *
 *   {baseUrl}/{src path}/w{w}[-ar{ar}[-fx{fx}-fy{fy}]]-q{q}.{fmt}
 *
 * e.g. `/lazy-ease/_img/alpine-dawn.jpg/w640-ar1-fx30-fy45-q75.webp`. Tokens
 * and revisions are left out: a static host checks neither. Numbers use the
 * same canonical form as the default loader, so one variant has one file.
 * Extra `params` go into a query string the host ignores; the demo's service
 * worker reads them to throttle (see static/sw.js).
 */

export type StaticFormat = Extract<ImageFormat, 'avif' | 'webp'>

/** No JPEG: every browser the component targets decodes WebP (spec 6.4). */
export const STATIC_FORMATS: readonly StaticFormat[] = ['avif', 'webp']
export const STATIC_QUALITIES: readonly number[] = [75]

/** File name of one variant inside its source's directory. */
export function variantFile({ width, aspectRatio, focalPoint, quality, format }: Omit<ImageRequest, 'src'>): string {
  const ar = aspectRatio === undefined ? '' : `-ar${formatNumber(aspectRatio)}`
  const focus = aspectRatio === undefined || !focalPoint ? '' : `-fx${formatNumber(focalPoint.x)}-fy${formatNumber(focalPoint.y)}`
  return `w${formatNumber(width)}${ar}${focus}-q${formatNumber(quality)}.${format}`
}

export interface StaticLoaderOptions {
  baseUrl: string
  /** Narrow these to a subset of what the build renders (the full ladder, every ratio). */
  widths?: readonly number[]
  ratios?: readonly number[]
  formats?: readonly StaticFormat[]
  /** Query parameters for the service worker; the host ignores them. */
  params?: Record<string, string | number>
}

export function createStaticLoader({
  baseUrl,
  widths = DEFAULT_WIDTHS,
  ratios = DEFAULT_RATIOS,
  formats = STATIC_FORMATS,
  params = {},
}: StaticLoaderOptions): ImageLoader {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    widths,
    ratios,
    qualities: STATIC_QUALITIES,
    formats,
    url: (request) => {
      if (!(STATIC_FORMATS as readonly string[]).includes(request.format)) {
        throw new Error(`The static loader has no ${request.format} variants`)
      }
      const query = Object.keys(params)
        .sort()
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
        .join('&')
      return `${base}${encodePath(request.src)}/${variantFile(request)}${query ? `?${query}` : ''}`
    },
  }
}
