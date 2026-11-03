// Network throttle for the static demo (spec 13), standing in for the demo
// server's. The static loader adds `latency` and `kbps` to image URLs as a
// query string the host ignores; this worker reads them, waits `latency` ms
// and streams the body at `kbps`. Only image variants under /_img/ are
// touched. Until the worker controls the page (first visit), images load at
// real speed.

const TICKS_PER_SECOND = 20

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== location.origin || !url.pathname.includes('/_img/')) return
  const kbps = Number(url.searchParams.get('kbps'))
  if (!(kbps > 0)) return
  const latency = Math.max(0, Number(url.searchParams.get('latency')) || 0)
  event.respondWith(throttled(event.request, latency, kbps))
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
