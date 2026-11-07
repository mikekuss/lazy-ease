import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { outputSize, type FocalPoint } from '@lazy-ease/core'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { render } from '../src/render.js'
import { solid, split } from './fixtures.js'

// `outputSize` in core predicts what the renderer encodes. Checked against
// real sharp output, so a srcset can label each candidate with its true width.
const SOURCES: [number, number][] = [
  [1200, 400],
  [40, 40],
  [400, 1200],
  [801, 599],
  [333, 777],
  [2000, 1000],
]
// Fractional widths reach the rounding in the renderer. 1.1 with a 2.333
// ratio rounds the target height to 0, which the renderer treats as no height.
const WIDTHS = [1.1, 1.4, 63.6, 64, 100.5, 128, 384, 640, 640.4, 1080]
const RATIOS = [undefined, 0.5, 1, 1.333, 2.333]
const FOCI: (FocalPoint | undefined)[] = [undefined, { x: 30, y: 45 }, { x: 100, y: 0 }]

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lazy-ease-output-'))
  for (const [w, h] of SOURCES) await writeFile(path.join(dir, `${w}x${h}.png`), await solid(w, h).png().toBuffer())
  // Stored 400 × 200 with EXIF orientation 6, so 200 × 400 once oriented.
  await writeFile(path.join(dir, 'rotated.jpg'), await (await split(400, 200)).withMetadata({ orientation: 6 }).jpeg().toBuffer())
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('outputSize against the renderer', () => {
  for (const [srcWidth, srcHeight] of SOURCES) {
    it(`matches every variant of a ${srcWidth} × ${srcHeight} source`, async () => {
      for (const width of WIDTHS) {
        for (const aspectRatio of RATIOS) {
          for (const focalPoint of aspectRatio === undefined ? [undefined] : FOCI) {
            const encoded = await render(path.join(dir, `${srcWidth}x${srcHeight}.png`), {
              width,
              aspectRatio,
              focalPoint,
              quality: 75,
              format: 'webp',
            })
            const meta = await sharp(encoded.body).metadata()
            const predicted = outputSize(srcWidth, srcHeight, { width, aspectRatio, focalPoint })
            const label = JSON.stringify({ width, aspectRatio, focalPoint })
            expect({ width: meta.width, height: meta.height }, label).toEqual({
              width: predicted.width,
              height: predicted.height,
            })
          }
        }
      }
    }, 60_000)
  }

  it('predicts in oriented pixels for a source with EXIF rotation', async () => {
    const file = path.join(dir, 'rotated.jpg')
    expect(await sharp(file).metadata()).toMatchObject({ width: 400, height: 200, orientation: 6 })
    for (const width of WIDTHS) {
      for (const aspectRatio of RATIOS) {
        for (const focalPoint of aspectRatio === undefined ? [undefined] : FOCI) {
          const encoded = await render(file, { width, aspectRatio, focalPoint, quality: 75, format: 'webp' })
          const meta = await sharp(encoded.body).metadata()
          const predicted = outputSize(200, 400, { width, aspectRatio, focalPoint })
          const label = JSON.stringify({ width, aspectRatio, focalPoint })
          expect({ width: meta.width, height: meta.height }, label).toEqual({
            width: predicted.width,
            height: predicted.height,
          })
        }
      }
    }
  }, 60_000)
})
