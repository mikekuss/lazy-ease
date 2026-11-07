import { describe, expect, it } from 'vitest'
import { cropWindow } from '../src/focal.js'
import { classicCandidates, fullLadder } from '../src/widths.js'
import { outputSize } from '../src/output.js'

describe('outputSize', () => {
  it('keeps the request width apart from the encoded width', () => {
    // A 1200 × 400 source cropped square has 400 × 400 pixels to give.
    expect(outputSize(1200, 400, { width: 640, aspectRatio: 1 })).toEqual({ requestWidth: 640, width: 400, height: 400 })
    expect(outputSize(1200, 400, { width: 384, aspectRatio: 1 })).toEqual({ requestWidth: 384, width: 384, height: 384 })
    expect(outputSize(1200, 400, { width: 640, aspectRatio: 1, focalPoint: { x: 10, y: 50 } })).toEqual({
      requestWidth: 640,
      width: 400,
      height: 400,
    })
  })

  it('places the square window of a 1200 × 400 source around the focal point', () => {
    expect(cropWindow(1200, 400, 1, { x: 50, y: 50 })).toEqual({ left: 400, top: 0, width: 400, height: 400 })
    expect(cropWindow(1200, 400, 1, { x: 10, y: 50 })).toEqual({ left: 0, top: 0, width: 400, height: 400 })
    expect(cropWindow(1200, 400, 1, { x: 75, y: 20 })).toEqual({ left: 700, top: 0, width: 400, height: 400 })
    expect(cropWindow(1200, 400, 1, { x: 100, y: 0 })).toEqual({ left: 800, top: 0, width: 400, height: 400 })
  })

  it('collapses every request for a 40 px original to 40 px', () => {
    // A 56 px avatar asks for the smallest ladder width; the source caps it.
    const widths = classicCandidates({ width: 56, ladder: [64, 128, 256], srcWidth: 40 })
    expect(widths).toEqual([64])
    for (const width of [64, 128, 256]) {
      expect(outputSize(40, 40, { width, aspectRatio: 1 })).toEqual({ requestWidth: width, width: 40, height: 40 })
      expect(outputSize(40, 40, { width })).toEqual({ requestWidth: width, width: 40, height: 40 })
    }
  })

  it('works with a custom small ladder at both ends', () => {
    const ladder = [128, 256, 512, 1024]
    expect(fullLadder({ ladder, srcWidth: 100 })).toEqual([128])
    expect(fullLadder({ ladder, srcWidth: 600 })).toEqual([128, 256, 512])
    expect(fullLadder({ ladder, srcWidth: 5000 })).toEqual(ladder)
    const outputs = fullLadder({ ladder, srcWidth: 600 }).map((width) => outputSize(600, 450, { width }))
    expect(outputs).toEqual([
      { requestWidth: 128, width: 128, height: 96 },
      { requestWidth: 256, width: 256, height: 192 },
      { requestWidth: 512, width: 512, height: 384 },
    ])
    expect(outputSize(100, 75, { width: 128 })).toEqual({ requestWidth: 128, width: 100, height: 75 })
  })

  it('scales uncropped requests with the source ratio and never upscales', () => {
    expect(outputSize(2000, 1000, { width: 640 })).toEqual({ requestWidth: 640, width: 640, height: 320 })
    expect(outputSize(300, 200, { width: 640 })).toEqual({ requestWidth: 640, width: 300, height: 200 })
    expect(outputSize(801, 599, { width: 384 })).toEqual({ requestWidth: 384, width: 384, height: 287 })
  })

  it('rounds fractional request widths as the renderer does', () => {
    // Uncropped: the renderer resizes to round(width × min(1, srcWidth / width)).
    expect(outputSize(100, 50, { width: 1.4 })).toEqual({ requestWidth: 1.4, width: 1, height: 1 })
    expect(outputSize(2000, 1000, { width: 63.6 })).toEqual({ requestWidth: 63.6, width: 64, height: 32 })
    expect(outputSize(2000, 1000, { width: 100.5 })).toEqual({ requestWidth: 100.5, width: 101, height: 51 })
    expect(outputSize(300, 200, { width: 640.4 })).toEqual({ requestWidth: 640.4, width: 300, height: 200 })
    // Cropped: the target box is round(width) × round(width / ratio).
    expect(outputSize(2000, 1000, { width: 100.5, aspectRatio: 1 })).toEqual({ requestWidth: 100.5, width: 101, height: 101 })
    expect(outputSize(40, 40, { width: 63.6, aspectRatio: 1 })).toEqual({ requestWidth: 63.6, width: 40, height: 40 })
  })

  it('treats a target height that rounds to 0 as no crop height', () => {
    // round(1.1 / 2.333) is 0, so the renderer resizes by width only.
    expect(outputSize(2000, 1000, { width: 1.1, aspectRatio: 2.333 })).toEqual({ requestWidth: 1.1, width: 1, height: 1 })
    expect(outputSize(1200, 400, { width: 1.1, aspectRatio: 2.333, focalPoint: { x: 30, y: 45 } })).toEqual({
      requestWidth: 1.1,
      width: 1,
      height: 1,
    })
  })

  it('rejects sizes that have no output', () => {
    expect(() => outputSize(0, 100, { width: 64 })).toThrow(RangeError)
    expect(() => outputSize(100, 100, { width: 0 })).toThrow(RangeError)
    expect(() => outputSize(100, 100, { width: 64, aspectRatio: 0 })).toThrow(RangeError)
  })
})
