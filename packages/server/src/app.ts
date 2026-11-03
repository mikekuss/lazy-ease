import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import sharp from 'sharp'
import { createPlaceholder, orientedSize, svgToDataUri, type PlaceholderMode } from './placeholder.js'
import { resolveSource } from './source.js'

/** Keep in sync with DEFAULT_WIDTHS in the `lazy-ease` package. */
export const DEFAULT_WIDTHS: readonly number[] = [
  64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
]

export type OutputFormat = 'avif' | 'webp' | 'jpeg' | 'png'
const OUTPUT_FORMATS: readonly OutputFormat[] = ['avif', 'webp', 'jpeg', 'png']

export interface ImageServerOptions {
  /** Directory the source images are read from. */
  root: string
  widths?: readonly number[]
  /** Formats offered to browsers that accept them, in order of preference. JPEG is the fallback. */
  formats?: readonly OutputFormat[]
  defaultQuality?: number
  /** Cache-Control max-age in seconds. */
  maxAge?: number
  /** Number of encoded images kept in memory. 0 disables the cache. */
  cacheSize?: number
}

interface Encoded {
  body: Uint8Array
  type: string
}

/**
 * Hono app with three routes:
 * - `GET /image?src&w&h&q&fmt` resized, re-encoded image
 * - `GET /placeholder?src&ar&mode` tiny SVG placeholder
 * - `GET /meta?src&ar` JSON with intrinsic size and the placeholder as a data URI
 */
export function createImageApp({
  root,
  widths = DEFAULT_WIDTHS,
  formats = ['webp'],
  defaultQuality = 75,
  maxAge = 60 * 60 * 24 * 365,
  cacheSize = 200,
}: ImageServerOptions): Hono {
  const app = new Hono()
  const cache = new Map<string, Encoded>()
  const maxWidth = widths[widths.length - 1] ?? 3840

  const remember = (key: string, value: Encoded) => {
    if (cacheSize <= 0) return
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
  }

  const cacheHeaders = { 'Cache-Control': `public, max-age=${maxAge}, immutable` }

  app.get('/image', async (c) => {
    const file = await resolveSource(root, c.req.query('src'))
    const requestedWidth = parseNumber(c.req.query('w'), 'w')
    if (requestedWidth === undefined) throw new HTTPException(400, { message: 'Missing w' })
    const requestedHeight = parseNumber(c.req.query('h'), 'h')
    if (requestedHeight !== undefined && requestedHeight > maxWidth * 4) {
      throw new HTTPException(400, { message: 'h is too large' })
    }
    const quality = clamp(parseNumber(c.req.query('q'), 'q') ?? defaultQuality, 1, 100)
    const fmt = c.req.query('fmt') ?? 'auto'
    const format = negotiate(fmt, c.req.header('accept') ?? '', formats)

    // Snap to an allowed width and keep the requested aspect ratio.
    const width = widths.find((w) => w >= requestedWidth) ?? maxWidth
    const height = requestedHeight && Math.round((requestedHeight * width) / requestedWidth)

    const key = [file, width, height, quality, format].join('|')
    let encoded = cache.get(key)
    if (!encoded) {
      encoded = await encode(file, width, height, quality, format)
      remember(key, encoded)
    }

    return c.body(encoded.body as Uint8Array<ArrayBuffer>, 200, {
      ...cacheHeaders,
      'Content-Type': encoded.type,
      ...(fmt === 'auto' ? { Vary: 'Accept' } : null),
    })
  })

  app.get('/placeholder', async (c) => {
    const file = await resolveSource(root, c.req.query('src'))
    const mode = (c.req.query('mode') ?? 'blur') as PlaceholderMode
    if (mode !== 'blur' && mode !== 'color') throw new HTTPException(400, { message: 'Invalid mode' })
    const svg = await createPlaceholder(file, { aspectRatio: parseNumber(c.req.query('ar'), 'ar'), mode })
    return c.body(svg, 200, { ...cacheHeaders, 'Content-Type': 'image/svg+xml' })
  })

  app.get('/meta', async (c) => {
    const file = await resolveSource(root, c.req.query('src'))
    const { width, height } = orientedSize(await sharp(file).metadata())
    const placeholder = await createPlaceholder(file, { aspectRatio: parseNumber(c.req.query('ar'), 'ar') })
    return c.json({ width, height, placeholder: svgToDataUri(placeholder) }, 200, cacheHeaders)
  })

  return app
}

async function encode(
  file: string,
  width: number,
  height: number | undefined,
  quality: number,
  format: OutputFormat,
): Promise<Encoded> {
  const image = sharp(file).rotate()
  const source = orientedSize(await image.metadata())

  // Never upscale. Shrink the target box instead so the aspect ratio survives.
  const scale = Math.min(
    1,
    (source.width ?? width) / width,
    height ? (source.height ?? height) / height : 1,
  )
  image.resize({
    width: Math.round(width * scale),
    height: height ? Math.round(height * scale) : undefined,
    fit: height ? 'cover' : 'inside',
    position: 'centre',
  })

  switch (format) {
    case 'avif':
      image.avif({ quality, effort: 4 })
      break
    case 'webp':
      image.webp({ quality })
      break
    case 'jpeg':
      image.jpeg({ quality, mozjpeg: true })
      break
    case 'png':
      image.png()
      break
  }
  return { body: await image.toBuffer(), type: `image/${format}` }
}

function negotiate(fmt: string, accept: string, formats: readonly OutputFormat[]): OutputFormat {
  if (fmt !== 'auto') {
    if ((OUTPUT_FORMATS as readonly string[]).includes(fmt)) return fmt as OutputFormat
    throw new HTTPException(400, { message: 'Invalid fmt' })
  }
  return formats.find((format) => accept.includes(`image/${format}`)) ?? 'jpeg'
}

function parseNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new HTTPException(400, { message: `Invalid ${name}` })
  }
  return number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
