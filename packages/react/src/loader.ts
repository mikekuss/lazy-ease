export type ImageFormat = 'avif' | 'webp' | 'jpeg' | 'png'

export interface ImageRequest {
  src: string
  width: number
  height?: number
  quality?: number
  format?: ImageFormat
}

/** Turns an image request into a URL. Swap it to target another backend or CDN. */
export interface ImageLoader {
  url(request: ImageRequest): string
}

export interface LoaderOptions {
  /** Where @lazy-ease/server is mounted. Defaults to `/_img`. */
  baseUrl?: string
  /** Extra query parameters added to every URL. */
  params?: Record<string, string | number>
}

export function createLoader({ baseUrl = '/_img', params = {} }: LoaderOptions = {}): ImageLoader {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    url: ({ src, width, height, quality, format }) => {
      const search = new URLSearchParams()
      const values = { src, w: width, h: height, q: quality, fmt: format, ...params }
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) search.set(key, String(value))
      }
      return `${base}/image?${search}`
    },
  }
}
