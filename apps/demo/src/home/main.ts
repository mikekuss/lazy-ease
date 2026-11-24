import { createLazyEase, createLoader, detectAvif, focusReveal, type Attachment, type ImageLoader, type LazyEase } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { cssText } from '@lazy-ease/vanilla/css'
import * as thumbhash from 'thumbhash'
import { CARD, CELLS, type CatalogSource } from '../catalog'
import { BASE, STATIC } from '../mode'
import { INERT } from '../prerender'
import { createStaticLoader } from '../staticLoader'
import { PRESETS, type PresetName } from '../throttle'

// The start page: one photo in every kind of placeholder lazy-ease paints,
// each with the line that builds it. Replay loads them again with new URLs.

const sheet = document.createElement('style')
sheet.textContent = cssText
document.head.append(sheet)

/** One entry of /api/images (written to api/images.json in the static build). */
interface SourceImage {
  src: string
  thumbhash: string
  color: string
}

const PHOTOS: [string, CatalogSource][] = [
  ['Glacier', CARD],
  ['Canyon', CELLS[0]!],
  ['Meadow', CELLS[1]!],
  ['Night', CELLS[2]!],
]

const smooth = thumbhashDecoder(thumbhash)
const raw = thumbhashDecoder(thumbhash, { blur: 0 })

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
  placeholder: (image: SourceImage) => string
  focus?: boolean
}

// One controller per decoder; each attach brings its own loader.
const config = { detectFormat: detectAvif, fadeDuration: 900 }
const blurred = createLazyEase({ ...config, thumbhash: smooth })
const blocky = createLazyEase({ ...config, thumbhash: raw })

const KINDS: Record<string, Kind> = {
  color: { le: blurred, placeholder: (image) => image.color },
  thumbhash: { le: blurred, placeholder: (image) => `thumbhash:${image.thumbhash}` },
  png: { le: blocky, placeholder: (image) => `thumbhash:${image.thumbhash}` },
  uri: { le: blurred, placeholder: (image) => gradient(image.thumbhash) },
  focus: { le: blurred, placeholder: (image) => `thumbhash:${image.thumbhash}`, focus: true },
  none: { le: blurred, placeholder: () => 'none' },
}

const form = document.getElementById('kinds-bar') as HTMLFormElement
const photo = form.elements.namedItem('photo') as HTMLSelectElement
const net = form.elements.namedItem('net') as HTMLSelectElement
photo.innerHTML = PHOTOS.map(([label], i) => `<option value="${i}">${label}</option>`).join('')
// The static host throttles through a service worker that never controls the
// site root (it would also control the LCP route), so it has no network select.
if (STATIC) net.closest('label')!.hidden = true
for (const element of document.querySelectorAll<HTMLElement>('[data-live]')) element.hidden = STATIC

let images = new Map<string, SourceImage>()
let attachments: Attachment[] = []
let run = 0

function makeLoader(): ImageLoader {
  const params = { run: `home-${Date.now()}-${run}` }
  if (STATIC) return createStaticLoader({ baseUrl: `${BASE}_img`, params })
  const preset = net.value as PresetName
  return createLoader({ params: { ...(PRESETS[preset] ? { throttle: preset } : {}), ...params } })
}

/** Attaches every tile again: new img elements, new URLs, so each starts from its placeholder. */
function play() {
  for (const attachment of attachments) attachment.destroy()
  run++
  const loader = makeLoader()
  const [, source] = PHOTOS[Number(photo.value)]!
  const image = images.get(source.src)
  if (!image) return
  attachments = [...document.querySelectorAll<HTMLElement>('.kind [data-le]')].map((box) => {
    const kind = KINDS[box.dataset.kind!]!
    box.style.aspectRatio = `${source.width} / ${source.height}`
    box.style.background = ''
    box.innerHTML = `<img alt="" src="${INERT}">`
    return kind.le.attach(box.querySelector('img')!, {
      loader,
      src: source.src,
      srcWidth: source.width,
      srcHeight: source.height,
      placeholder: kind.placeholder(image),
      ...(kind.focus ? { reveal: focusReveal } : {}),
    })
  })
}

form.addEventListener('change', play)
document.getElementById('replay')!.addEventListener('click', play)

const list = STATIC ? `${BASE}api/images.json` : '/api/images'
const load = (): Promise<void> =>
  fetch(list)
    .then((response) => (response.ok ? (response.json() as Promise<SourceImage[]>) : Promise.reject(response.status)))
    .then((entries) => {
      images = new Map(entries.map((entry) => [entry.src, entry]))
      play()
    })
    // On the first start the server may still be fetching the photos.
    .catch(() => new Promise((resolve) => setTimeout(resolve, 2000)).then(load))
void load()
