import { useSyncExternalStore } from 'react'

/**
 * The GitHub Pages build (`vite build --mode static`): no demo server, images
 * are pre-rendered files behind a custom loader, the throttle is a service
 * worker. `pnpm dev` is the live mode.
 */
export const STATIC = import.meta.env.MODE === 'static'

/** `/` live, `/lazy-ease/` on Pages. Ends in a slash. */
export const BASE = import.meta.env.BASE_URL

/** Registers the throttling service worker (static/sw.js). Static mode only. */
export function registerThrottleWorker(): void {
  if (!STATIC || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch((error: unknown) => {
    console.warn('Throttle service worker not registered; images load at real speed.', error)
  })
}

const subscribe = (listener: () => void) => {
  if (!('serviceWorker' in navigator)) return () => {}
  navigator.serviceWorker.addEventListener('controllerchange', listener)
  return () => navigator.serviceWorker.removeEventListener('controllerchange', listener)
}

/** Whether the service worker controls this page, so the throttle applies. */
export function useThrottleWorkerActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !STATIC || Boolean(navigator.serviceWorker?.controller),
    () => !STATIC,
  )
}
