// Network throttle for the static demo (spec 13), standing in for the demo
// server's. The static loader adds `latency` and `kbps` to image URLs as a
// query string the host ignores; this worker reads them, waits `latency` ms
// and streams the body at `kbps`. Only image variants under /_img/ are
// touched. Until the worker controls the page (first visit), images load at
// real speed.

const TICKS_PER_SECOND = 20

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Registered for the fade route only, never for the site root, so the
// LCP route is outside every worker. Earlier deployments registered it for
// the root; such a registration removes itself on its next update check.
const ROOT = new URL('./', self.location).href
const retired = self.registration.scope === ROOT

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(retired ? self.registration.unregister() : self.clients.claim()),
)

self.addEventListener('fetch', (event) => {
  if (retired) return
  const url = new URL(event.request.url)
  if (url.origin !== location.origin || !url.pathname.includes('/_img/')) return
  const kbps = Number(url.searchParams.get('kbps'))
  if (kbps > 0) {
    const latency = Math.max(0, Number(url.searchParams.get('latency')) || 0)
    return event.respondWith(throttled(event.request, latency, kbps))
  }
  // A native image from the HTML has no parameters: the page wrote the top
  // bar's choice into Cache Storage ({ latency, kbps }, or {} for real speed).
  event.respondWith(
    caches
      .open('le-demo')
      .then((cache) => cache.match('net'))
      .then((stored) => (stored ? stored.json() : {}))
      .then(({ latency, kbps }) => (kbps > 0 ? throttled(event.request, Math.max(0, latency || 0), kbps) : fetch(event.request))),
  )
})

async function throttled(request, latency, kbps) {
  await sleep(latency)
  const response = await fetch(request)
  if (!response.body) return response

  const body = new Uint8Array(await response.arrayBuffer())
  const bytesPerTick = Math.max(1, Math.round((kbps * 1000) / 8 / TICKS_PER_SECOND))
  let offset = 0
  const stream = new ReadableStream({
    async pull(controller) {
      if (offset >= body.length) return controller.close()
      await sleep(1000 / TICKS_PER_SECOND)
      controller.enqueue(body.subarray(offset, (offset += bytesPerTick)))
    },
  })
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
}
