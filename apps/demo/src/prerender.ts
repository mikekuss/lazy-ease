import { candidateSet, classicCandidates, DEFAULT_WIDTHS, fullLadder, type CandidateSet, type ImageLoader } from '@lazy-ease/core'
import { ARTICLE, ARTICLE_SIZES, AVATAR, CARD, HERO } from './catalog'

/**
 * The HTML a template (PHP or any server) writes for the hero and the
 * native/JS pair, with every URL computed ahead of time. The fade route and
 * the LCP route get the same candidates; only the attributes that carry them
 * differ. Pure, so the Vite plugin runs it at build time (and per request in
 * development) and tests can compare both routes.
 */

/** Oriented size, placeholder color and revision of a source, from `computeMetadata`. */
export interface SourceMeta {
  width: number
  height: number
  color: string
  revision: string
  thumbhash: string
}

export type Metadata = (src: string) => SourceMeta

export interface PrerenderOptions {
  loader: Pick<ImageLoader, 'url'>
  meta: Metadata
  /** Write `v` into the URLs (the live server checks it; a static host has no revisions). */
  versions: boolean
}

/** The template avatar's size: large enough to read next to the two photos. */
const PAIR_AVATAR = 120

/** The inert pixel a deferred img shows until its target is assigned. */
export const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

const attr = (value: string | number) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function ladder({ loader, meta, versions }: PrerenderOptions, src: string, crop?: { aspectRatio: number; focalPoint?: { x: number; y: number } }, widths?: number[]): CandidateSet {
  const { width, height, revision } = meta(src)
  return candidateSet({
    widths: widths ?? fullLadder({ ladder: DEFAULT_WIDTHS, srcWidth: width }),
    srcWidth: width,
    srcHeight: height,
    loader,
    src,
    aspectRatio: crop?.aspectRatio,
    focalPoint: crop?.focalPoint,
    quality: 75,
    format: 'webp',
    version: versions ? revision : undefined,
  })
}

/** The uncropped list of one source, as a template writes it into a native img. */
export function nativeSet(options: PrerenderOptions, src: string): CandidateSet {
  return ladder(options, src)
}

/** Both hero candidate lists, as the LCP and the fade route emit them. */
export function heroSets(options: PrerenderOptions): { mobile: CandidateSet; desktop: CandidateSet } {
  return {
    mobile: ladder(options, HERO.mobile.src, HERO.mobile.crop),
    desktop: ladder(options, HERO.desktop.src, HERO.desktop.crop),
  }
}

const heroBox = (min: number, max: number) => [min, max].map((ar) => `--le-ar:${ar}`)

/**
 * The art-directed hero. `native` is the LCP route: real sources in the first
 * HTML, high fetch priority, no preload (a desktop preload would also load on
 * mobile). `fade` defers the same lists behind an inert pixel and a color
 * placeholder per breakpoint; the controller copies them on intersection and
 * fades once, so the hero never paints progressively.
 */
export function heroMarkup(mode: 'native' | 'fade', options: PrerenderOptions): string {
  const { mobile, desktop } = heroSets(options)
  const m = options.meta(HERO.mobile.src)
  const d = options.meta(HERO.desktop.src)
  const [mobileAr, desktopAr] = heroBox(HERO.mobile.crop.aspectRatio, HERO.desktop.crop.aspectRatio)
  // The img and source dimensions are those of the largest crop each lists.
  const size = (src: string, crop: { aspectRatio: number }) => {
    const { width, height } = options.meta(src)
    const w = Math.min(width, Math.round(height * crop.aspectRatio))
    return { width: w, height: Math.round(w / crop.aspectRatio) }
  }
  const ms = size(HERO.mobile.src, HERO.mobile.crop)
  const ds = size(HERO.desktop.src, HERO.desktop.crop)
  const list = (set: CandidateSet) =>
    mode === 'native'
      ? `srcset="${attr(set.srcset ?? set.src)}" sizes="${HERO.sizes}"`
      : `data-le-srcset="${attr(set.srcset ?? set.src)}" data-le-sizes="${HERO.sizes}"`
  const img =
    mode === 'native'
      ? `src="${attr(mobile.src)}" ${list(mobile)} fetchpriority="high"`
      : `src="${INERT}" ${list(mobile)}`
  return `<style>
  [data-hero] { display:block; ${mobileAr}; aspect-ratio:var(--le-ar); background-color:${m.color} }
  @media ${HERO.media} { [data-hero] { ${desktopAr}; background-color:${d.color} } }
  [data-hero] img { display:block; width:100%; height:100%; object-fit:cover }
</style>
<span ${mode === 'fade' ? 'data-le ' : ''}data-hero>
  <picture>
    <source media="${HERO.media}" width="${ds.width}" height="${ds.height}" ${list(desktop)}>
    <img alt="${attr(HERO.alt)}" width="${ms.width}" height="${ms.height}" ${img}>
  </picture>
</span>`
}

/**
 * The native/JS pair of the recipes, for one opted-in area: a native article
 * image that a late script adopts without hiding it, a prepared single URL
 * that fades, and a prepared avatar list.
 */
export function pairMarkup(options: PrerenderOptions): string {
  const article = options.meta(ARTICLE.src)
  const native = ladder(options, ARTICLE.src)
  const card = options.meta(CARD.src)
  const single = ladder(options, CARD.src, undefined, [1080])
  const avatar = ladder(options, AVATAR.src, { aspectRatio: 1, focalPoint: AVATAR.focalPoint }, classicCandidates({ width: PAIR_AVATAR, ladder: DEFAULT_WIDTHS, srcWidth: options.meta(AVATAR.src).width }))
  return `<figure class="pair-item" data-case="native">
  <img data-le alt="Night sky over hills" width="${article.width}" height="${article.height}"
       style="display:block;width:100%;height:auto;background-color:${article.color}"
       loading="lazy" decoding="async"
       src="${attr(native.src)}" srcset="${attr(native.srcset ?? native.src)}" sizes="${ARTICLE_SIZES}">
  <figcaption>Native</figcaption>
</figure>
<figure class="pair-item" data-case="fade">
  <span data-le style="display:block;aspect-ratio:${card.width}/${card.height};background-color:${card.color}">
    <img alt="Glacier at noon" width="${card.width}" height="${card.height}"
         style="display:block;width:100%;height:100%;object-fit:cover"
         src="${INERT}" data-le-url="${attr(single.src)}">
  </span>
  <figcaption>Fade, one URL</figcaption>
</figure>
<figure class="pair-item" data-case="avatar">
  <span data-le style="display:block;width:${PAIR_AVATAR}px;height:${PAIR_AVATAR}px;border-radius:50%;background-color:${options.meta(AVATAR.src).color}">
    <img alt="Pines" width="${PAIR_AVATAR}" height="${PAIR_AVATAR}" data-le-sizes="${PAIR_AVATAR}px"
         src="${INERT}" data-le-srcset="${attr(avatar.srcset ?? avatar.src)}">
  </span>
  <figcaption>Fade, 1× and 2×</figcaption>
</figure>`
}

/** Where the library lives. */
export const LINKS = [
  ['https://github.com/mikekuss/lazy-ease#readme', 'Docs'],
  ['https://github.com/mikekuss/lazy-ease', 'GitHub'],
  ['https://www.npmjs.com/package/@lazy-ease/react', 'npm'],
]

const NETWORKS = [
  ['off', 'Real speed'],
  ['fast-4g', 'Fast 4G'],
  ['slow-4g', 'Slow 4G'],
  ['3g', '3G'],
]

/** Reveal speeds: the demo's 800 ms is longer than the library's 400 ms default, so the reveal is visible. */
export const FADES = [
  ['0', 'None'],
  ['150', '150 ms'],
  ['400', '400 ms (default)'],
  ['800', '800 ms'],
  ['1500', '1.5 s'],
]
export const DEMO_FADE = 800

/**
 * The top bar's controls. Network is a cookie: the demo server throttles
 * every image request by it. Reveal is the fade duration of the whole page
 * (localStorage, read by the page scripts). Both reload the page; Replay
 * reloads it with a new run id (sessionStorage) that the page scripts put
 * into their image URLs. Plain script inline; the LCP route has no bar, so
 * it stays without any script.
 */
const NAV_SCRIPT = `(() => {
  const bar = document.querySelector('.site')
  // React or HTML for every code example, remembered; set here, before the examples paint.
  const root = document.documentElement
  try { root.dataset.flavor = localStorage.getItem('le-flavor') === 'html' ? 'html' : 'react' } catch { root.dataset.flavor = 'react' }
  document.addEventListener('click', (event) => {
    const pick = event.target instanceof Element && event.target.closest('[data-flavor-pick]')
    if (!pick) return
    root.dataset.flavor = pick.getAttribute('data-flavor-pick')
    try { localStorage.setItem('le-flavor', root.dataset.flavor) } catch {}
  })
  // A reload or Replay starts at the top, so the images further down load as they scroll in, not all at once.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  const net = bar.querySelector('[data-net]')
  const fade = bar.querySelector('[data-fade]')
  const replay = () => {
    try { sessionStorage.setItem('le-run', String(Date.now())) } catch {}
    location.reload()
  }
  bar.querySelector('[data-replay]').addEventListener('click', replay)
  if (net) {
    const chosen = /(?:^|;\\s*)le-net=([\\w-]+)/.exec(document.cookie)
    if (chosen) net.value = chosen[1]
    net.addEventListener('change', () => {
      document.cookie = 'le-net=' + net.value + '; path=/; max-age=31536000; SameSite=Lax'
      replay()
    })
  }
  if (fade) {
    try { const stored = localStorage.getItem('le-fade'); if (stored !== null) fade.value = stored } catch {}
    fade.addEventListener('change', () => {
      try { localStorage.setItem('le-fade', fade.value) } catch {}
      replay()
    })
  }
})()`

const select = (label: string, attribute: string, options: string[][], selected: string) =>
  `<label class="pick"><span>${label}</span><select ${attribute}>${options
    .map(([value, text]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${text}</option>`)
    .join('')}</select></label>`

/**
 * The sticky top bar of the demo page. The static host has no server to
 * throttle by the cookie (and no worker may control the site root, which
 * would also control the LCP route), so its bar has no network select.
 */
export function navMarkup(base: string, live: boolean): string {
  const net = live ? select('Network', 'data-net', NETWORKS, 'fast-4g') : '<a class="pick live-only" href="https://github.com/mikekuss/lazy-ease/tree/main/apps/demo">Network in the live demo</a>'
  return `<header class="site"><a class="brand" href="${base}">lazy-ease</a><nav class="links">${LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav><div class="tools">${net}${select('Reveal', 'data-fade', FADES, String(DEMO_FADE))}<button type="button" class="replay" data-replay title="Replay the page" aria-label="Replay the page">↻</button></div></header>
<script>${NAV_SCRIPT}</script>`
}
