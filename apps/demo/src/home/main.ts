import { createLazyEase, createLoader, detectAvif, focusReveal, parsePlaceholder, type Attachment, type ImageLoader, type LazyEase, type ThumbHashDecoder } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { cssText } from '@lazy-ease/vanilla/css'
import * as thumbhash from 'thumbhash'
import { CARD, CELLS, type CatalogSource } from '../catalog'
import { BASE, STATIC } from '../mode'
import { INERT } from '../prerender'
import { createStaticLoader } from '../staticLoader'

// The start page: one photo in each kind of placeholder lazy-ease paints,
// then the extra props. Each box gets its placeholder painted inline, as a
// server template writes it, so it shows in full while the controller waits
// (dwellTime); then the image fades in once. Replay does it again with new
// URLs.

const sheet = document.createElement('style')
sheet.textContent = cssText
document.head.append(sheet)

/** One entry of /api/images (api/images.json in the static build). */
interface SourceImage {
  src: string
  thumbhash: string
  color: string
}

const smooth = thumbhashDecoder(thumbhash)
const raw = thumbhashDecoder(thumbhash, { blur: 0 })

// Long enough to see the placeholder before the image starts loading.
const config = { detectFormat: detectAvif, fadeDuration: 900, dwellTime: 900 }
const blurred = createLazyEase({ ...config, thumbhash: smooth })
const blocky = createLazyEase({ ...config, thumbhash: raw })

/**
 * A custom data URI: a vertical gradient between the top and bottom colors
 * of the ThumbHash, as a template could write it ahead of time.
 */
function gradient(hash: string): string {
  const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
  const { w, h, rgba } = thumbhash.thumbHashToRGBA(bytes)
  const row = (y: number) => {
    const sum = [0, 0, 0]
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) sum[c]! += rgba[(y * w + x) * 4 + c]!
    return `rgb(${sum.map((v) => Math.round(v / w)).join(' ')})`
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><linearGradient id='g' x2='0' y2='1'><stop stop-color='${row(0)}'/><stop offset='1' stop-color='${row(h - 1)}'/></linearGradient><rect width='1' height='1' fill='url(#g)'/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

interface Kind {
  le: LazyEase
  decoder: ThumbHashDecoder
  source: CatalogSource
  placeholder: (image: SourceImage) => string
  focus?: boolean
}

const KINDS: Record<string, Kind> = {
  svg: { le: blurred, decoder: smooth, source: CARD, placeholder: (image) => `thumbhash:${image.thumbhash}` },
  png: { le: blocky, decoder: raw, source: CARD, placeholder: (image) => `thumbhash:${image.thumbhash}` },
  color: { le: blurred, decoder: smooth, source: CARD, placeholder: (image) => image.color },
  focus: { le: blurred, decoder: smooth, source: CELLS[0]!, placeholder: (image) => `thumbhash:${image.thumbhash}`, focus: true },
  uri: { le: blurred, decoder: smooth, source: CELLS[1]!, placeholder: (image) => gradient(image.thumbhash) },
}

for (const element of document.querySelectorAll<HTMLElement>('[data-live]')) element.hidden = STATIC

let images = new Map<string, SourceImage>()
const attachments = new Map<HTMLElement, Attachment>()
let run = 0

const loaderFor = (key: string): ImageLoader => {
  const params = { run: `home-${Date.now()}-${key}` }
  return STATIC ? createStaticLoader({ baseUrl: `${BASE}_img`, params }) : createLoader({ params })
}

/** Attaches one tile again: a new img and new URLs, so it starts from its placeholder. */
function play(box: HTMLElement) {
  const kind = KINDS[box.dataset.kind!]!
  const image = images.get(kind.source.src)
  if (!image) return
  attachments.get(box)?.destroy()
  if (box.dataset.kind === 'color') box.closest('.kind')!.querySelector('code')!.textContent = `placeholder="${image.color}"`
  box.style.aspectRatio = `${kind.source.width} / ${kind.source.height}`
  box.innerHTML = `<img alt="" src="${INERT}">`
  const placeholder = parsePlaceholder(kind.placeholder(image), kind.decoder)
  for (const key of ['backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition'] as const) box.style[key] = ''
  Object.assign(box.style, placeholder?.style, placeholder?.lazy?.())
  attachments.set(
    box,
    kind.le.attach(box.querySelector('img')!, {
      loader: loaderFor(`${box.dataset.kind}-${run++}`),
      src: kind.source.src,
      srcWidth: kind.source.width,
      srcHeight: kind.source.height,
      ...(kind.focus ? { reveal: focusReveal } : {}),
    }),
  )
}

const boxes = [...document.querySelectorAll<HTMLElement>('.kind [data-le]')]
for (const box of boxes) {
  box.closest('.kind')!.querySelector('button')!.addEventListener('click', () => play(box))
}

const list = STATIC ? `${BASE}api/images.json` : '/api/images'
const load = (): Promise<void> =>
  fetch(list)
    .then((response) => (response.ok ? (response.json() as Promise<SourceImage[]>) : Promise.reject(response.status)))
    .then((entries) => {
      images = new Map(entries.map((entry) => [entry.src, entry]))
      boxes.forEach(play)
    })
    // On the first start the server may still be fetching the photos.
    .catch(() => new Promise((resolve) => setTimeout(resolve, 2000)).then(load))
void load()
