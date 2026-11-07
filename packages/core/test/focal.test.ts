import { describe, expect, it } from 'vitest'
import { coverPosition, cropWindow, focusInWindow, normalizeFocalPoint, percentPosition } from '../src/focal.js'
import { createLoader, type ImageRequest } from '../src/loader.js'

describe('normalizeFocalPoint', () => {
  it('rounds to whole percent and clamps to 0–100', () => {
    expect(normalizeFocalPoint({ x: 30.4, y: 69.5 })).toEqual({ x: 30, y: 70 })
    expect(normalizeFocalPoint({ x: -5, y: 140 })).toEqual({ x: 0, y: 100 })
  })

  it('drops the center, which is the default', () => {
    expect(normalizeFocalPoint({ x: 50, y: 50 })).toBeUndefined()
    expect(normalizeFocalPoint({ x: 50.2, y: 49.6 })).toBeUndefined()
    expect(normalizeFocalPoint({ x: 50, y: 30 })).toEqual({ x: 50, y: 30 })
  })

  it('ignores missing and non-finite points', () => {
    expect(normalizeFocalPoint(undefined)).toBeUndefined()
    expect(normalizeFocalPoint({ x: Number.NaN, y: 10 })).toBeUndefined()
    expect(normalizeFocalPoint({ x: 10, y: Number.POSITIVE_INFINITY })).toBeUndefined()
  })
})

describe('cropWindow', () => {
  it('keeps the full height of a wider source and centers the point', () => {
    // 2000×1000 cropped to 1:1 is a 1000×1000 window; x = 30 % is at 600 px.
    expect(cropWindow(2000, 1000, 1, { x: 30, y: 50 })).toEqual({ left: 100, top: 0, width: 1000, height: 1000 })
  })

  it('keeps the full width of a taller source', () => {
    expect(cropWindow(1000, 2000, 2, { x: 50, y: 25 })).toEqual({ left: 0, top: 250, width: 1000, height: 500 })
  })

  it('stops at the source edges', () => {
    expect(cropWindow(2000, 1000, 1, { x: 0, y: 50 }).left).toBe(0)
    expect(cropWindow(2000, 1000, 1, { x: 100, y: 50 }).left).toBe(1000)
    expect(cropWindow(1000, 2000, 2, { x: 50, y: 100 }).top).toBe(1500)
  })

  it('is the full source when the ratios match', () => {
    expect(cropWindow(1600, 900, 1.778, { x: 10, y: 90 })).toEqual({ left: 0, top: 0, width: 1600, height: 900 })
  })
})

describe('focusInWindow', () => {
  it('is the center when the window could be centered on the point', () => {
    const window = cropWindow(2000, 1000, 1, { x: 30, y: 50 })
    expect(focusInWindow(2000, 1000, window, { x: 30, y: 50 })).toEqual({ x: 50, y: 50 })
  })

  it('moves off center when an edge stops the window', () => {
    const window = cropWindow(2000, 1000, 1, { x: 10, y: 50 })
    expect(focusInWindow(2000, 1000, window, { x: 10, y: 50 })).toEqual({ x: 20, y: 50 })
  })
})

describe('coverPosition', () => {
  it('centers the point within the edges, in container units', () => {
    expect(coverPosition(2, { x: 30, y: 70 })).toBe(
      'clamp(100cqw - max(100cqw, 100cqh * 2), 50cqw - max(100cqw, 100cqh * 2) * 0.3, 0px) ' +
        'clamp(100cqh - max(100cqh, 100cqw / 2), 50cqh - max(100cqh, 100cqw / 2) * 0.7, 0px)',
    )
  })

  it('writes numbers in canonical form', () => {
    expect(coverPosition(1600 / 500, { x: 33, y: 0 })).toContain('100cqh * 3.2)')
    expect(coverPosition(4 / 3, { x: 0, y: 100 })).toContain('100cqw / 1.333) * 1,')
  })

  it('falls back to percentages', () => {
    expect(percentPosition({ x: 30, y: 70 })).toBe('30% 70%')
  })
})

describe('createLoader', () => {
  const base: ImageRequest = { src: '/a.jpg', width: 640, aspectRatio: 1.5, quality: 75, format: 'webp' }
  const loader = createLoader()

  it('sorts fx and fy in with the other parameters', () => {
    expect(loader.url({ ...base, focalPoint: { x: 30, y: 70 } })).toBe('/_img/a.jpg?ar=1.5&fmt=webp&fx=30&fy=70&q=75&w=640')
    expect(loader.url({ ...base, focalPoint: { x: 0, y: 100 }, version: 'v1' })).toBe(
      '/_img/a.jpg?ar=1.5&fmt=webp&fx=0&fy=100&q=75&v=v1&w=640',
    )
  })

  it('omits them without a focal point', () => {
    expect(loader.url(base)).toBe('/_img/a.jpg?ar=1.5&fmt=webp&q=75&w=640')
  })
})
