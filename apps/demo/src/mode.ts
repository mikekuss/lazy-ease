import { PRESETS, type PresetName } from './throttle'

/**
 * The GitHub Pages build (`vite build --mode static`): no demo server, images
 * are pre-rendered files behind a custom loader, the throttle is a service
 * worker. `pnpm dev` is the live mode.
 */
export const STATIC = import.meta.env.MODE === 'static'

/** `/` live, `/lazy-ease/` on Pages. Ends in a slash. */
export const BASE = import.meta.env.BASE_URL

/**
 * Registers the throttling service worker (static/sw.js) for one route's
 * scope. Static mode only. Never for the site root, so the LCP route stays
 * outside every worker.
 */
export function registerThrottleWorker(scope: string): void {
  if (!STATIC || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register(`${BASE}sw.js`, { scope }).catch((error: unknown) => {
    console.warn('Throttle service worker not registered; images load at real speed.', error)
  })
}

/**
 * The network speed the nav's select chose (a cookie the demo server reads
 * for every image request). Fast 4G until the viewer picks another.
 */
export function network(): PresetName {
  const value = /(?:^|;\s*)le-net=([\w-]+)/.exec(document.cookie)?.[1]
  return value && value in PRESETS ? (value as PresetName) : 'fast-4g'
}

/**
 * Throttle parameters for the static host's service worker, which has no
 * cookie to read. The live server throttles by the cookie alone.
 */
export function staticThrottle(): Record<string, number> {
  const profile = PRESETS[network()]
  return STATIC && profile ? { latency: profile.latency, kbps: profile.kbps } : {}
}

/** Changes with the nav's Replay, so every URL a page builds is new and the browser cache is cold. */
export function pageRun(): string {
  try {
    return sessionStorage.getItem('le-run') ?? '0'
  } catch {
    return '0'
  }
}

/** The reveal speed the top bar chose, for the whole page: 800 ms until the viewer picks another. */
export function fadeDuration(): number {
  try {
    const stored = localStorage.getItem('le-fade')
    if (stored !== null && Number.isFinite(Number(stored))) return Number(stored)
  } catch {}
  return 800
}
