// What both self-starting scripts do: read the settings on their script tag,
// then enhance every area marked `data-le-auto` once the document is parsed.
// They leave no globals behind.
import type { LazyEase, LazyEaseConfig } from '@lazy-ease/core'
import { enhance } from './index.js'

/** Reports an invalid setting on the console; the script still starts. */
export type Ignore = (name: string) => void

/**
 * Starts the script with `create`. `configureLoader` reads `data-base-url`
 * and what belongs to it into the config; without it, `data-base-url` is
 * reported and ignored.
 */
export function boot(create: (config: LazyEaseConfig) => LazyEase, configureLoader?: (data: DOMStringMap, config: LazyEaseConfig, ignore: Ignore) => void): void {
  const script = document.currentScript
  const data = script?.dataset ?? {}
  const start = () => {
    const config: LazyEaseConfig = {}
    const ignore: Ignore = (name) => console.error(new TypeError(`[lazy-ease] data-${name} ignored`), script)
    if (data.baseUrl !== undefined) configureLoader ? configureLoader(data, config, ignore) : ignore('base-url')
    const margin = data.rootMargin
    if (margin) {
      // The IntersectionObserver constructor is the parser: it throws for a margin without units.
      // Without one, every image loads at once and the margin does not matter.
      try {
        if (typeof IntersectionObserver == 'function') new IntersectionObserver(() => {}, { rootMargin: margin }).disconnect()
        config.rootMargin = margin
      } catch {
        ignore('root-margin')
      }
    }
    const dwell = data.dwellTime
    if (dwell !== undefined) {
      if (/^\d*\.?\d+$/.test(dwell)) config.dwellTime = +dwell
      else ignore('dwell-time')
    }
    const le = create(config)
    for (const root of document.querySelectorAll('[data-le-auto]')) {
      if (root.getAttribute('data-le-auto') !== 'off') enhance(le, root)
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
}
