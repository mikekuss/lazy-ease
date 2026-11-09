// The self-starting script, published as `@lazy-ease/vanilla/lazy-ease.min.js`.
// Its script tag activates it: it enhances every area marked `data-le-auto`
// once the document is parsed, and leaves no globals behind.
//
//   <script defer src="/assets/lazy-ease.min.js" data-base-url="/_img" data-formats="webp jpeg"></script>
//
// `data-base-url` configures the reference loader for `data-le-src` images;
// without it only prepared and native images work, and no URL is built in the
// browser. `data-formats` lists the formats the backend renders, best first.
// `data-root-margin` and `data-dwell-time` set the preload zone. An invalid
// setting is reported on the console and ignored; the script still starts.
import { createLazyEase, createLoader, type ImageFormat, type LazyEaseConfig } from '@lazy-ease/core'
import { enhance } from './index.js'

const script = document.currentScript
const data = script?.dataset ?? {}
const FORMATS = ['avif', 'webp', 'jpeg']

const start = () => {
  const config: LazyEaseConfig = {}
  const ignore = (name: string) => console.error(new TypeError(`[lazy-ease] data-${name} ignored`), script)
  if (data.baseUrl !== undefined) {
    let formats = data.formats?.split(/[\s,]+/).filter(Boolean) as ImageFormat[] | undefined
    if (formats?.some((format) => !FORMATS.includes(format))) {
      ignore('formats')
      formats = undefined
    }
    config.loader = createLoader(formats?.length ? { baseUrl: data.baseUrl, formats } : { baseUrl: data.baseUrl })
  }
  const margin = data.rootMargin
  if (margin) {
    // The IntersectionObserver constructor is the parser: it throws for a margin without units.
    try {
      new IntersectionObserver(() => {}, { rootMargin: margin }).disconnect()
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
  const le = createLazyEase(config)
  for (const root of document.querySelectorAll('[data-le-auto]')) {
    if (root.getAttribute('data-le-auto') !== 'off') enhance(le, root)
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
