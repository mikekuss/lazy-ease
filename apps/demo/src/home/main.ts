import { createLazyEase, createLoader, detectAvif, focusReveal, type Attachment, type ImageLoader } from '@lazy-ease/core'
import { cssText } from '@lazy-ease/vanilla/css'
import { BASE, STATIC } from '../mode'
import { INERT } from '../prerender'
import { createStaticLoader } from '../staticLoader'

// The start page. The prerender plugin wrote each tile with its placeholder
// inline (src/home/kinds.ts), as a server template does, so it shows from
// the first frame. This script only attaches the images: they wait a moment
// (dwellTime), then fade in once. Replay paints the placeholder again and
// loads the image with new URLs.

const sheet = document.createElement('style')
sheet.textContent = cssText
document.head.append(sheet)

// The placeholder is in the HTML, so the controller needs no decoder.
const le = createLazyEase({ detectFormat: detectAvif, fadeDuration: 900, dwellTime: 900 })

for (const element of document.querySelectorAll<HTMLElement>('[data-live]')) element.hidden = STATIC

const loaderFor = (key: string): ImageLoader => {
  const params = { run: `home-${Date.now()}-${key}` }
  return STATIC ? createStaticLoader({ baseUrl: `${BASE}_img`, params }) : createLoader({ params })
}

let run = 0

for (const box of document.querySelectorAll<HTMLElement>('.kind [data-le]')) {
  // The box as the HTML wrote it, placeholder included; the fade removes the placeholder.
  const initial = box.getAttribute('style') ?? ''
  let attachment: Attachment | undefined
  const play = () => {
    attachment?.destroy()
    box.setAttribute('style', initial)
    box.innerHTML = `<img alt="" src="${INERT}">`
    attachment = le.attach(box.querySelector('img')!, {
      loader: loaderFor(`${box.dataset.kind}-${run++}`),
      src: box.dataset.src!,
      srcWidth: Number(box.dataset.width),
      srcHeight: Number(box.dataset.height),
      ...(box.hasAttribute('data-focus') ? { reveal: focusReveal } : {}),
    })
  }
  box.closest('.kind')!.querySelector('button')!.addEventListener('click', play)
  play()
}
