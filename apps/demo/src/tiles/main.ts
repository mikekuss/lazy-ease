import { createLazyEase, createLoader, detectAvif, focusReveal, type Attachment, type ImageLoader } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { cssText } from '@lazy-ease/vanilla/css'
import * as thumbhash from 'thumbhash'
import { BASE, STATIC, fadeDuration, pageRun } from '../mode'
import { INERT } from '../prerender'
import { createStaticLoader } from '../staticLoader'

// The tiles of the start and placeholders pages. The prerender plugin wrote
// each with its placeholder inline (src/tiles/kinds.ts), as a server
// template does, so it shows from the first frame. This script only attaches
// the images: they wait a moment (dwellTime), so the placeholder is seen,
// then reveal once. A click on a tile paints its placeholder again and loads
// the image with new URLs.

const sheet = document.createElement('style')
sheet.textContent = cssText
document.head.append(sheet)

// The decoder is only for the SSR color tile, whose ThumbHash image the controller paints on activation.
const le = createLazyEase({ detectFormat: detectAvif, fadeDuration: fadeDuration(), dwellTime: 900, thumbhash: thumbhashDecoder(thumbhash) })

const loaderFor = (key: string): ImageLoader => {
  const params = { run: `${pageRun()}-${key}` }
  return STATIC ? createStaticLoader({ baseUrl: `${BASE}_img`, params }) : createLoader({ params })
}

let run = 0

// The reveal tiles' code lines name the page's speed.
for (const code of document.querySelectorAll('.tile code')) code.textContent = code.textContent!.replace('fadeDuration={…}', `fadeDuration={${fadeDuration()}}`)
const plays = new Map<HTMLElement, () => void>()

for (const box of document.querySelectorAll<HTMLElement>('.tile [data-le], .intro .backdrop [data-le]')) {
  // The box as the HTML wrote it, placeholder included; the reveal removes the placeholder.
  const initial = box.getAttribute('style') ?? ''
  const { src, width, height, placeholder, reveal } = box.dataset
  let attachment: Attachment | undefined
  const play = () => {
    attachment?.destroy()
    box.setAttribute('style', initial)
    box.innerHTML = `<img alt="" src="${INERT}">`
    attachment = le.attach(box.querySelector('img')!, {
      loader: loaderFor(`tile-${run++}`),
      src: src!,
      srcWidth: Number(width),
      srcHeight: Number(height),
      // The box fills its well (3:2) or the intro; the browser crops the uncropped image.
      fill: true,
      // The intro's photo comes at once; the tiles wait a moment, so their placeholder is seen.
      ...(box.closest('.intro') ? { dwellTime: 0 } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(reveal === 'focus' ? { reveal: focusReveal } : {}),
      ...(box.hasAttribute('data-transparent') ? { transparent: true } : {}),
    })
  }
  if (!box.closest('.intro')) box.addEventListener('click', play)
  plays.set(box, play)
  play()
}

// A panel's Replay plays all its tiles again.
for (const button of document.querySelectorAll<HTMLElement>('[data-replay-panel]')) {
  button.addEventListener('click', () => {
    for (const [box, play] of plays) if (button.closest('.usecase')!.contains(box)) play()
  })
}
