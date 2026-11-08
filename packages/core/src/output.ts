import { cropWindow, type FocalPoint } from './focal.js'

/** The part of an image request that decides the rendered pixel size. */
export interface OutputRequest {
  /** The `w` in the URL: a ladder width, not necessarily the encoded width. */
  width: number
  /** The `ar` in the URL. Absent when there is no crop. */
  aspectRatio?: number
  /** The normalized `fx`/`fy`. Absent for the center. */
  focalPoint?: FocalPoint
}

export interface OutputSize {
  /** The width the URL asks for. */
  requestWidth: number
  /** The width of the encoded image. Smaller than `requestWidth` when the source is too small. */
  width: number
  /** The height of the encoded image. */
  height: number
}

/**
 * The size of the image the reference backend encodes for `request` from a
 * source of `srcWidth × srcHeight` oriented pixels (after EXIF rotation). The
 * backend crops to the request ratio (around the focal point when one is
 * given) and never upscales, so a 640 request from a 400 px source encodes
 * 400 px. A srcset labels each candidate with `width`, and requests whose
 * outputs are identical can be collapsed into one.
 */
export function outputSize(srcWidth: number, srcHeight: number, request: OutputRequest): OutputSize {
  if (!(srcWidth >= 1 && srcHeight >= 1)) throw new RangeError(`Invalid source size: ${srcWidth} × ${srcHeight}`)
  const { width, aspectRatio, focalPoint } = request
  if (!(width >= 1)) throw new RangeError(`Invalid request width: ${width}`)
  if (aspectRatio !== undefined && !(aspectRatio > 0)) throw new RangeError(`Invalid aspect ratio: ${aspectRatio}`)
  // Mirrors `render()` in the server step by step. The renderer extracts a
  // focal window before resizing. A centered crop instead comes from resizing
  // the whole source with `cover`.
  const source =
    aspectRatio !== undefined && focalPoint
      ? cropWindow(srcWidth, srcHeight, aspectRatio, focalPoint)
      : { width: srcWidth, height: srcHeight }
  // A target height that rounds to 0 means no target height, as in the renderer.
  const height = aspectRatio !== undefined ? Math.round(width / aspectRatio) : 0
  // Never upscale: shrink the target box so its ratio survives.
  const scale = Math.min(1, source.width / width, height ? source.height / height : 1)
  const outWidth = Math.max(1, Math.round(width * scale))
  if (!height) {
    // `fit: inside` with only a width: sharp derives the height from the source ratio.
    return { requestWidth: width, width: outWidth, height: Math.max(1, Math.round((source.height * outWidth) / source.width)) }
  }
  return { requestWidth: width, width: outWidth, height: Math.max(1, Math.round(height * scale)) }
}
