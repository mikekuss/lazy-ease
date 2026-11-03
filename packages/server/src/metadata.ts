import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { DEFAULT_MAX_INPUT_PIXELS, inputOptions, mapSharpError, orientedSize } from './render.js'
import { resolveSource } from './source.js'

export interface ImageMetadata {
  /** Intrinsic size after EXIF rotation, for `srcWidth` and `srcHeight`. */
  width: number
  height: number
  /** Base64 ThumbHash. Use it as `placeholder={`thumbhash:${thumbhash}`}`. */
  thumbhash: string
  /** Dominant color as `#rrggbb`, usable as `placeholder` directly. */
  color: string
}

const hex = (n: number) => n.toString(16).padStart(2, '0')

/**
 * Metadata for upload or build scripts (spec 12.3): oriented size, a ThumbHash
 * from a thumbnail of at most 100 px and the dominant color.
 */
export async function computeMetadata(input: string | Buffer): Promise<ImageMetadata> {
  // From memory, so libvips does not cache or lock the file (see render).
  const buffer = typeof input === 'string' ? await readFile(input) : input
  const image = sharp(buffer, inputOptions(DEFAULT_MAX_INPUT_PIXELS)).rotate()
  const { width = 0, height = 0 } = orientedSize(await image.metadata())
  const [thumb, stats] = await Promise.all([
    image
      .clone()
      .resize(100, 100, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    image.clone().toColourspace('srgb').stats(),
  ])
  const hash = rgbaToThumbHash(thumb.info.width, thumb.info.height, thumb.data)
  const { r, g, b } = stats.dominant
  return {
    width,
    height,
    thumbhash: Buffer.from(hash).toString('base64'),
    color: `#${hex(r)}${hex(g)}${hex(b)}`,
  }
}

export interface MetaServerOptions {
  /** Directory the source images are read from. */
  root: string
}

/**
 * `GET /{src path}` returning `computeMetadata` as JSON (spec 12.2). For the
 * demo and local tooling only, not the public server. Mount it on its own
 * path, e.g. `/_meta`, so it cannot collide with source paths.
 */
export function createMetaApp({ root }: MetaServerOptions): Hono {
  const app = new Hono()
  app.get('/:path{.+}', async (c) => {
    const { file } = await resolveSource(root, c.req.param('path'))
    const metadata = await computeMetadata(file).catch((error: unknown) => {
      throw mapSharpError(error)
    })
    return c.json(metadata)
  })
  return app
}
