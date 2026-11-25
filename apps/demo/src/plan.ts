import { DEFAULT_WIDTHS, fullLadder, normalizeFocalPoint, snapRatio, type FocalPoint } from '@lazy-ease/core'
import { AVATAR, BANNER, CARD, CELLS, GROW, HERO, PRIVATE, SPLIT, ARTICLE, TINY, TRANSPARENT, type CatalogSource } from './catalog'

/**
 * Which source and crop each demo section uses. The pages render from these,
 * and the static build pre-renders exactly the variants they can request.
 */

/** The gallery cycles through these ratios. */
export const RATIOS: [string, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['2:3', 2 / 3],
]

/** The external-image case shows the original of this file. */
export const EXTERNAL_FILE = 'alpine-dawn.jpg'

/** Fixed card size, and the single-URL card without source dimensions. */
export const CARD_SIZE = { width: 320, height: 240 }
export const SINGLE = { src: CELLS[0]!.src, width: 320, height: 480 }
/** Width of the banner slot, for its image-set(). */
export const BANNER_WIDTH = 720

export const GALLERY_SIZE = { live: 40, static: 20 }

export const galleryRatio = (i: number, imageCount: number) =>
  RATIOS[(i * 2 + Math.floor(i / imageCount)) % RATIOS.length]!

export interface StaticVariantSet {
  src: string
  aspectRatio?: number
  focalPoint?: FocalPoint
  widths: number[]
}

/** The shadow panel's own width ladder (docs/image-recipes.md), off the default one at 512 and 1024. */
export const SHADOW_WIDTHS = [128, 256, 512, 1024]

/** Source, ratio, focus and widths beyond the default ladder. */
type Use = [CatalogSource, number?, FocalPoint?, number[]?]

/**
 * Every source and crop the static demo can request. Each gets the full width
 * ladder up to the source width: measured candidates, classic candidates,
 * prepared lists and the naive 100vw comparison are all subsets of it.
 * `gallery` are the sources of the scroll gallery.
 */
export function staticVariantSets(gallery: CatalogSource[]): StaticVariantSet[] {
  const uses: Use[] = [
    [HERO.mobile, HERO.mobile.crop.aspectRatio, HERO.mobile.crop.focalPoint],
    [HERO.desktop, HERO.desktop.crop.aspectRatio, HERO.desktop.crop.focalPoint],
    // The native/JS pair.
    [ARTICLE],
    [CARD],
    [AVATAR, 1, AVATAR.focalPoint],
    // Fixed and DPR, breakpoint ratio, resize.
    [TINY, 1],
    [CARD, CARD_SIZE.width / CARD_SIZE.height],
    [SPLIT, 4 / 3],
    [SPLIT, 2],
    [GROW, 1],
    // Fill gallery (browser crop of the uncropped ladder) and the single URL.
    ...CELLS.map((cell): Use => [cell]),
    [CELLS[0]!, SINGLE.width / SINGLE.height],
    [BANNER, BANNER.aspectRatio],
    // The start and placeholders pages' tiles: uncropped, as CELLS and CARD above.
    [TRANSPARENT],
    // The shadow panel's square (public on the static host).
    [PRIVATE, 1, undefined, SHADOW_WIDTHS],
  ]
  for (let i = 0; i < GALLERY_SIZE.static && gallery.length > 0; i++) {
    uses.push([gallery[i % gallery.length]!, galleryRatio(i, gallery.length)[1]])
  }

  const sets = new Map<string, StaticVariantSet>()
  for (const [source, ratio, focus, extra = []] of uses) {
    const aspectRatio = ratio === undefined ? undefined : snapRatio(ratio)
    const focalPoint = aspectRatio === undefined ? undefined : normalizeFocalPoint(focus)
    const key = `${source.src} ${aspectRatio} ${focalPoint?.x} ${focalPoint?.y}`
    const widths = fullLadder({ ladder: DEFAULT_WIDTHS, srcWidth: source.width })
    const set = sets.get(key) ?? { src: source.src, aspectRatio, focalPoint, widths }
    const more = extra.filter((width) => width <= source.width && !set.widths.includes(width))
    if (more.length > 0) set.widths = [...set.widths, ...more].sort((a, b) => a - b)
    sets.set(key, set)
  }
  return [...sets.values()]
}
