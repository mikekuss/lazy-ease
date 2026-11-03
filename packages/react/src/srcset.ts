import type { ImageFormat, ImageLoader } from './loader.js'

export interface SrcSetOptions {
  src: string
  /** Ladder widths, e.g. from `measuredCandidates`. */
  widths: readonly number[]
  /** A ratio-ladder value, or undefined for no crop. */
  aspectRatio?: number
  quality: number
  format: ImageFormat | 'auto'
  version?: string
  params?: Record<string, string>
  loader: Pick<ImageLoader, 'url'>
}

/**
 * The `w`-descriptor srcset. The `<img>` and the priority preload link both
 * use it, and React dedupes preloads only on identical strings, so the output
 * depends on nothing but the arguments: widths sorted ascending, no duplicates.
 */
export function buildSrcSet({ widths, loader, ...request }: SrcSetOptions): string {
  return [...new Set(widths)]
    .sort((a, b) => a - b)
    .map((width) => `${loader.url({ ...request, width })} ${width}w`)
    .join(', ')
}
