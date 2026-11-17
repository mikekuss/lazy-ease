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
}

export type Metadata = (src: string) => SourceMeta

export interface PrerenderOptions {
  loader: Pick<ImageLoader, 'url'>
  meta: Metadata
  /** Write `v` into the URLs (the live server checks it; a static host has no revisions). */
  versions: boolean
}

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
  const avatar = ladder(options, AVATAR.src, { aspectRatio: 1, focalPoint: AVATAR.focalPoint }, classicCandidates({ width: AVATAR.size, ladder: DEFAULT_WIDTHS, srcWidth: options.meta(AVATAR.src).width }))
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
  <span data-le style="display:block;width:${AVATAR.size}px;height:${AVATAR.size}px;border-radius:50%;background-color:${options.meta(AVATAR.src).color}">
    <img alt="Pines" width="${AVATAR.size}" height="${AVATAR.size}" data-le-sizes="${AVATAR.size}px"
         src="${INERT}" data-le-srcset="${attr(avatar.srcset ?? avatar.src)}">
  </span>
  <figcaption>Fade, 1× and 2×</figcaption>
</figure>`
}
