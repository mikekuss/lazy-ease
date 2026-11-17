/** Reading back what an image requested and what it got. Not used on the LCP route. */

export interface Variant {
  width?: number
  aspectRatio?: number
  focalPoint?: { x: number; y: number }
  quality?: number
  format?: string
}

/**
 * A variant from its URL: the default loader's query string, or the static
 * loader's `…/w640-ar1-fx30-fy45-q75.webp` file name.
 */
export function variantOf(src: string): Variant {
  const url = new URL(src, location.href)
  const file = /\/w(\d+)(?:-ar([\d.]+))?(?:-fx(\d+)-fy(\d+))?-q([\d.]+)\.(\w+)$/.exec(url.pathname)
  if (file) {
    const [, w, ar, fx, fy, q, format] = file
    return {
      width: Number(w),
      aspectRatio: ar ? Number(ar) : undefined,
      focalPoint: fx ? { x: Number(fx), y: Number(fy) } : undefined,
      quality: Number(q),
      format,
    }
  }
  const number = (name: string) => {
    const value = url.searchParams.get(name)
    return value ? Number(value) : undefined
  }
  const fx = number('fx')
  return {
    width: number('w'),
    aspectRatio: number('ar'),
    focalPoint: fx === undefined ? undefined : { x: fx, y: number('fy')! },
    quality: number('q'),
    format: url.searchParams.get('fmt') ?? undefined,
  }
}

const sizes = new Map<string, Promise<string>>()

/**
 * The decoded pixels behind `url`. An img's naturalWidth is divided by the
 * density the browser picked from srcset, so the URL is decoded on its own
 * (from the memory cache, no new request for a cacheable response).
 */
export function decodedSize(url: string): Promise<string> {
  let size = sizes.get(url)
  if (!size) {
    const probe = new Image()
    probe.src = url
    size = probe.decode().then(
      () => `${probe.naturalWidth}×${probe.naturalHeight}`,
      () => '',
    )
    sizes.set(url, size)
  }
  return size
}

/** `w640 → 640×427`: the requested width and the decoded pixels, or the size of an original. */
export async function pixels(img: HTMLImageElement): Promise<string> {
  if (!img.currentSrc || !img.naturalWidth) return ''
  const { width } = variantOf(img.currentSrc)
  const actual = await decodedSize(img.currentSrc)
  return width ? `w${width} → ${actual}` : actual
}

/** The state an attached image reports on its marked owner. */
export function stateOf(img: HTMLImageElement): string {
  return img.closest('[data-le]')?.getAttribute('data-state') ?? 'idle'
}
