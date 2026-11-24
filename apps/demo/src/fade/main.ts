import { cssText } from '@lazy-ease/vanilla/css'
import { BASE, STATIC, registerThrottleWorker } from '../mode'
import { pixels, stateOf } from '../readout'
import { PRESETS, type PresetName } from '../throttle'

// The fade route: the prerendered hero and the native/JS pair, enhanced by
// the same code the self-starting script runs, optionally late. Its settings
// live in the query string, so every run is a fresh page load.

// The stylesheet a PHP page links, here from the package's string export.
const sheet = document.createElement('style')
sheet.textContent = cssText
document.head.append(sheet)

const query = new URLSearchParams(location.search)
const net = (query.get('net') ?? 'off') as PresetName
const profile = PRESETS[net] ?? null
const late = Math.max(0, Number(query.get('late')) || 0)

const form = document.getElementById('settings') as HTMLFormElement
const status = document.getElementById('status')!
;(form.elements.namedItem('net') as HTMLSelectElement).value = profile ? net : 'off'
;(form.elements.namedItem('late') as HTMLSelectElement).value = String(late)
form.addEventListener('submit', (event) => {
  event.preventDefault()
  const data = new FormData(form)
  const next = new URLSearchParams({ net: String(data.get('net')), late: String(data.get('late')), run: String(Date.now()) })
  location.search = next.toString()
})

// The static host throttles through its service worker, which only controls
// this route (see static/sw.js), never the LCP route.
registerThrottleWorker(`${BASE}fade/`)
if (STATIC && profile && !navigator.serviceWorker?.controller) {
  document.getElementById('throttle-note')!.hidden = false
}

/**
 * Throttle and cache-bust the deferred URLs before anything activates them.
 * The live server strips these parameters again; the static host ignores
 * them and its service worker reads them. Native URLs are already loading.
 */
const extra = new URLSearchParams()
if (profile) {
  if (STATIC) {
    extra.set('latency', String(profile.latency))
    extra.set('kbps', String(profile.kbps))
  } else extra.set('throttle', net)
}
if (query.has('run')) extra.set('run', query.get('run')!)
const withParams = (url: string) => (extra.size ? `${url}${url.includes('?') ? '&' : '?'}${extra}` : url)
if (extra.size) {
  for (const element of document.querySelectorAll<HTMLElement>('[data-le-srcset],[data-le-url]')) {
    const url = element.getAttribute('data-le-url')
    if (url) element.setAttribute('data-le-url', withParams(url))
    const srcset = element.getAttribute('data-le-srcset')
    if (srcset) {
      const list = srcset.split(/,\s+/).map((candidate) => {
        const [href, descriptor] = candidate.trim().split(/\s+/)
        return descriptor ? `${withParams(href!)} ${descriptor}` : withParams(href!)
      })
      element.setAttribute('data-le-srcset', list.join(', '))
    }
  }
}

// Captions: state and requested → decoded pixels, refreshed on changes.
const images = [...document.querySelectorAll<HTMLImageElement>('[data-le-auto] img')]
const captions = new Map<HTMLImageElement, HTMLElement>()
for (const img of images) {
  // The hero shows no readout: it is the demo, not a measurement.
  const figure = img.closest('figure')
  if (!figure) continue
  const caption = document.createElement('small')
  caption.className = 'readout'
  figure.append(caption)
  captions.set(img, caption)
}
const refresh = () => {
  for (const [img, caption] of captions) {
    const state = stateOf(img)
    void pixels(img).then((size) => (caption.textContent = [state, size].filter(Boolean).join(' · ')))
  }
}
for (const img of images) img.addEventListener('load', refresh)
new MutationObserver(refresh).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state', 'src', 'srcset'] })
refresh()

/**
 * Whether the native image, once painted, is ever hidden again: sampled every
 * frame from page start until a second after the script has started.
 */
const native = document.querySelector<HTMLImageElement>('[data-case="native"] img')
let hiddenFrames = 0
let paintedBeforeStart = false
let started = false
let sampleUntil = Infinity
const sample = () => {
  if (native?.complete && native.naturalWidth > 0) {
    if (!started) paintedBeforeStart = true
    const style = getComputedStyle(native)
    if (Number(style.opacity) < 1 || style.visibility !== 'visible' || !native.currentSrc.includes('_img')) hiddenFrames++
  }
  if (performance.now() < sampleUntil) requestAnimationFrame(sample)
  else report()
}
requestAnimationFrame(sample)

const nativeResult = document.createElement('p')
nativeResult.className = 'note'
nativeResult.id = 'native-check'
const report = () => {
  nativeResult.textContent = !paintedBeforeStart
    ? 'Native image was not painted before the script started.'
    : hiddenFrames === 0
      ? 'Native image painted before the script and stayed visible.'
      : `Native image hidden for ${hiddenFrames} frames.`
  nativeResult.dataset.result = paintedBeforeStart ? (hiddenFrames === 0 ? 'pass' : 'fail') : 'skip'
  document.querySelector('.pair')!.after(nativeResult)
}

const start = async () => {
  const [{ createLazyEase }, { enhance }] = await Promise.all([import('@lazy-ease/core'), import('@lazy-ease/vanilla')])
  started = true
  const le = createLazyEase({ onStateChange: refresh })
  for (const root of document.querySelectorAll('[data-le-auto]')) enhance(le, root)
  status.textContent = late ? `Script started after ${late / 1000} s` : 'Script started'
  sampleUntil = performance.now() + 1000
}

if (late) {
  status.textContent = `Script starts in ${late / 1000} s`
  setTimeout(start, late)
} else void start()
