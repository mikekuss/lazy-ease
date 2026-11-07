import type { ImageLoader, ImageRequest } from './loader.js'
import { outputSize } from './output.js'

export interface CandidateSetOptions extends Omit<ImageRequest, 'width'> {
  /** Request widths, e.g. from `measuredCandidates`, `classicCandidates` or `fullLadder`. */
  widths: readonly number[]
  /** Oriented source width. With `srcHeight`, the encoded sizes are known. */
  srcWidth?: number
  /** Oriented source height. */
  srcHeight?: number
  loader: Pick<ImageLoader, 'url'>
}

export interface CandidateSet {
  /**
   * The `w`-descriptor list, labeled with the encoded width of each variant.
   * Absent when only one distinct variant remains or the encoded sizes are
   * unknown; then `src` alone is the image.
   */
  srcset?: string
  /** The single URL, or the largest candidate when there is a list. */
  src: string
}

/**
 * The candidates the browser chooses from (the `candidates.json` rule). With
 * both source dimensions, each request is labeled with the width the backend
 * actually encodes, and requests that encode the same pixels are merged into
 * the first of them; one remaining variant becomes a single `src`. Without
 * them nothing is known about the outputs, so the result is a single URL for
 * the largest request width.
 */
export function candidateSet({ widths, srcWidth, srcHeight, loader, ...request }: CandidateSetOptions): CandidateSet {
  const sorted = [...new Set(widths)].sort((a, b) => a - b)
  const url = (width: number) => loader.url({ ...request, width })
  if (srcWidth === undefined || srcHeight === undefined) return { src: url(sorted[sorted.length - 1]!) }
  const seen = new Set<string>()
  const list: string[] = []
  let src = ''
  for (const width of sorted) {
    const output = outputSize(srcWidth, srcHeight, { width, aspectRatio: request.aspectRatio, focalPoint: request.focalPoint })
    const key = `${output.width}x${output.height}`
    if (seen.has(key)) continue
    seen.add(key)
    src = url(width)
    list.push(`${src} ${output.width}w`)
  }
  return list.length > 1 ? { srcset: list.join(', '), src } : { src }
}
