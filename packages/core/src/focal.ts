import { formatNumber } from './numbers.js'

/** A point in the source image, in percent of its width and height (0–100). */
export interface FocalPoint {
  x: number
  y: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The canonical focal point (spec 6.1): whole percent, clamped to 0–100.
 * Undefined for the center, which is the default and never sent, and for
 * non-finite values.
 */
export function normalizeFocalPoint(point: FocalPoint | undefined): FocalPoint | undefined {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined
  const x = clamp(Math.round(point.x), 0, 100)
  const y = clamp(Math.round(point.y), 0, 100)
  return x === 50 && y === 50 ? undefined : { x, y }
}

export interface CropWindow {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The part of a `width × height` source that a crop to `ratio` keeps (spec
 * 12.1): the largest window of that ratio, placed so the focal point is as
 * close to its center as the source edges allow. Whole pixels. The server
 * crops with this same function.
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

/** Where `focus` lands inside `window`, in percent of the window. */
export function focusInWindow(width: number, height: number, window: CropWindow, focus: FocalPoint): FocalPoint {
  return {
    x: clamp((((focus.x / 100) * width - window.left) / window.width) * 100, 0, 100),
    y: clamp((((focus.y / 100) * height - window.top) / window.height) * 100, 0, 100),
  }
}

const n = formatNumber

/**
 * A CSS position for an image of `ratio` (width / height) drawn with `cover`
 * in a size container: the focal point as close to the box center as the
 * image edges allow (spec 5.4). The box size comes from container units, so
 * this is right in the server HTML and on every resize, with no script.
 */
export function coverPosition(ratio: number, focus: FocalPoint): string {
  const r = n(ratio)
  const renderedWidth = `max(100cqw, 100cqh * ${r})`
  const renderedHeight = `max(100cqh, 100cqw / ${r})`
  const x = `clamp(100cqw - ${renderedWidth}, 50cqw - ${renderedWidth} * ${n(focus.x / 100)}, 0px)`
  const y = `clamp(100cqh - ${renderedHeight}, 50cqh - ${renderedHeight} * ${n(focus.y / 100)}, 0px)`
  return `${x} ${y}`
}

/** The plain percentage position, for when the image ratio is unknown. */
export function percentPosition(focus: FocalPoint): string {
  return `${focus.x}% ${focus.y}%`
}
