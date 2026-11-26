import { cssText } from '@lazy-ease/vanilla/css'
import { BASE, STATIC, fadeDuration, pageRun, registerThrottleWorker, staticThrottle } from '../mode'

// Template HTML with the vanilla script: the native/JS pair on the demo page,
// and on the fade route also the prerendered hero (the demo page shows that
// route in a frame). Enhanced by the same code the self-starting script runs,
// optionally late. A click on
// an image loads it again with new URLs. The network speed is the nav's: the
// demo server throttles every image by its cookie, the static host's service
// worker by the parameters added here (and its own copy for native images).

// The stylesheet a PHP page links, here from the package's string export.
const sheet = document.createElement('style')
sheet.textContent = cssText
document.head.append(sheet)

const query = new URLSearchParams(location.search)
const late = Math.max(0, Number(query.get('late')) || 0)

const form = document.querySelector<HTMLFormElement>('#template-settings, #settings')!
const select = form.elements.namedItem('late') as HTMLSelectElement
select.value = String(late)
select.addEventListener('change', () => {
  const next = new URLSearchParams({ late: select.value })
  try {
    sessionStorage.setItem('le-run', String(Date.now()))
  } catch {}
  location.search = next.toString()
})

// The static host throttles the fade route through its service worker (see
// static/sw.js), never the LCP route or the site root.
if (location.pathname.endsWith('/fade/')) registerThrottleWorker(`${BASE}fade/`)

let clicks = 0
/** Throttle (static host) and cache-bust parameters for a URL the script activates. */
const withParams = (url: string, key: string) => {
  const extra = new URLSearchParams({ ...staticThrottle(), run: `${pageRun()}-${key}` })
  return `${url}${url.includes('?') ? '&' : '?'}${extra}`
}
const srcsetWith = (srcset: string, key: string) =>
  srcset
    .split(/,\s+/)
    .map((candidate) => {
      const [href, descriptor] = candidate.trim().split(/\s+/)
      return descriptor ? `${withParams(href!, key)} ${descriptor}` : withParams(href!, key)
    })
    .join(', ')

/** The deferred URLs of a subtree, made new before anything activates them. Native URLs are already loading. */
function prepare(root: Element, key: string) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-le-srcset],[data-le-url]')) {
    const url = element.getAttribute('data-le-url')
    if (url) element.setAttribute('data-le-url', withParams(url, key))
    const srcset = element.getAttribute('data-le-srcset')
    if (srcset) element.setAttribute('data-le-srcset', srcsetWith(srcset, key))
  }
}

// The markup as the template wrote it, for a replay.
const templates = new Map<Element, string>()
for (const element of document.querySelectorAll('.hero-area, .pair-item')) templates.set(element, element.innerHTML)
for (const root of document.querySelectorAll('[data-le-auto]')) prepare(root, 'page')

const start = async () => {
  const [{ createLazyEase }, { enhance }] = await Promise.all([import('@lazy-ease/core'), import('@lazy-ease/vanilla')])
  const le = createLazyEase({ fadeDuration: fadeDuration() })
  for (const root of document.querySelectorAll('[data-le-auto]')) enhance(le, root)

  // A click on an image: the native one gets new URLs and loads as the browser does; the others are written
  // again from the template, with their placeholder, and enhanced anew.
  for (const element of templates.keys()) {
    element.addEventListener('click', () => {
      const key = `click-${++clicks}`
      if (element.matches('[data-case="native"]')) {
        const img = element.querySelector('img')!
        img.srcset = srcsetWith(img.getAttribute('srcset')!.replace(/[?&](latency|kbps|run)=[^&\s,]*/g, ''), key)
        img.src = withParams(img.getAttribute('src')!.replace(/[?&](latency|kbps|run)=[^&\s,]*/g, ''), key)
        return
      }
      element.innerHTML = templates.get(element)!
      prepare(element, key)
      enhance(le, element.closest('[data-le-auto]')!)
    })
  }
}

// The section's Replay: every template image again, and the other sources (React) with them.
document.querySelector('[data-replay-template]')?.addEventListener('click', () => {
  for (const element of templates.keys()) element.dispatchEvent(new MouseEvent('click'))
  dispatchEvent(new Event('le-replay-sources'))
})

if (late) setTimeout(start, late)
else void start()

// Static host: native images have no parameters, so the worker reads the nav's choice from Cache Storage.
if (STATIC && 'caches' in window) {
  void caches.open('le-demo').then((cache) => cache.put('net', new Response(JSON.stringify(staticThrottle()))))
}
