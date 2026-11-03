import sharp, { type Metadata } from 'sharp'

export type PlaceholderMode = 'blur' | 'color'

export interface PlaceholderOptions {
  /** Crop to this width / height ratio before shrinking. */
  aspectRatio?: number
  mode?: PlaceholderMode
  /** Width of the embedded thumbnail in pixels. */
  size?: number
}

/**
 * Builds a tiny SVG placeholder meant to be inlined as a data URI. `blur`
 * embeds a ~16px thumbnail behind a blur filter (~0.5 KB), `color` is a 1×1
 * rect in the image's dominant color (~150 bytes).
 */
export async function createPlaceholder(
  input: string | Buffer,
  { aspectRatio, mode = 'blur', size = 16 }: PlaceholderOptions = {},
): Promise<string> {
  const image = sharp(input).rotate()

  if (mode === 'color') {
    const { dominant } = await image.stats()
    const color = `rgb(${dominant.r},${dominant.g},${dominant.b})`
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><rect width="1" height="1" fill="${color}"/></svg>`
  }

  const { width = 1, height = 1 } = await image.clone().metadata().then(orientedSize)
  const ratio = aspectRatio ?? width / height
  const w = size
  const h = Math.max(1, Math.round(size / ratio))

  const thumb = await image.resize(w, h, { fit: 'cover' }).webp({ quality: 50 }).toBuffer()
  const href = `data:image/webp;base64,${thumb.toString('base64')}`
  // The feFuncA step keeps the blurred edges opaque instead of fading to transparent.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<filter id="b" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1"/>` +
    `<feComponentTransfer><feFuncA type="discrete" tableValues="1 1"/></feComponentTransfer></filter>` +
    `<image width="100%" height="100%" preserveAspectRatio="none" filter="url(#b)" href="${href}"/></svg>`
  )
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** Width and height after EXIF rotation. */
export function orientedSize(meta: Metadata): { width?: number; height?: number } {
  const swap = (meta.orientation ?? 1) >= 5
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
}
