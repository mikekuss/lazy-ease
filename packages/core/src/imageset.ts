import { normalizeFocalPoint, type FocalPoint } from './focal.js'
import { normalizeLoader, snapQuality, type ImageLoader, type ImageLoaderFunction } from './loader.js'
import { formatNumber } from './numbers.js'
import { snapRatio } from './ratios.js'
import { cssUrl } from './styles.js'
import { fullLadder } from './widths.js'

export interface ImageSetOptions {
  /** Logical source, as for an image. */
  src: string
  /** Width of the CSS slot the background is drawn in, in CSS px. */
  width: number
  loader: ImageLoader | ImageLoaderFunction
  /** Crop ratio, snapped to the loader's ratio ladder. Omit for the uncropped source. */
  aspectRatio?: number
  /** Point to keep in the crop, in percent. Only with `aspectRatio`. */
  focalPoint?: FocalPoint
  /** Snapped to the nearest quality the loader allows. Default 75. */
  quality?: number
  /** Oriented source width: no density asks for more than the source has. */
  srcWidth?: number
  version?: string
  token?: string
  /** Device pixel ratios to offer. Default `[1, 2]`. */
  densities?: readonly number[]
}

const TYPES = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg' }

/**
 * The CSS `image-set()` value for a decorative background: one option per
 * density and declared format, best format first, each URL from the loader.
 * Each density gets the smallest permitted ladder width that covers the slot
 * at that density. A density that would repeat the URL of a lower one is
 * left out. A loader with `formats: 'auto'` gets untyped options. Use the
 * value in a rule gated on `[data-le-visible]`; media queries can supply
 * other slot widths.
 */
export function imageSet({ src, width, loader: input, aspectRatio, focalPoint, quality = 75, srcWidth, version, token, densities = [1, 2] }: ImageSetOptions): string {
  const loader = normalizeLoader(input)
  const widths = fullLadder({ ladder: loader.widths, srcWidth })
  const ratio = aspectRatio === undefined ? undefined : snapRatio(aspectRatio, loader.ratios)
  const request = {
    src,
    aspectRatio: ratio,
    focalPoint: ratio === undefined ? undefined : normalizeFocalPoint(focalPoint),
    quality: snapQuality(quality, loader.qualities),
    version,
    token,
  }
  const options: string[] = []
  for (const format of loader.formats === 'auto' ? (['auto'] as const) : loader.formats) {
    const seen = new Set<string>()
    for (const density of [...densities].sort((a, b) => a - b)) {
      const target = width * density
      const url = loader.url({ ...request, format, width: widths.find((w) => w >= target) ?? widths[widths.length - 1]! })
      if (seen.has(url)) continue
      seen.add(url)
      options.push(`${cssUrl(url)} ${formatNumber(density)}x${format === 'auto' ? '' : ` type("${TYPES[format]}")`}`)
    }
  }
  return `image-set(${options.join(', ')})`
}
