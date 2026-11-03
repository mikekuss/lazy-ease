import { DEFAULT_WIDTHS, fullLadder, snapRatio } from 'lazy-ease'

/**
 * Which source and crop each demo section uses. App renders from these, and
 * the static build pre-renders exactly the variants they can request.
 */

/** The ratio grid uses images 0 to 4, the gallery cycles through all. */
export const RATIOS: [string, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['2:3', 2 / 3],
]

export const HERO_RATIO = 21 / 9

/** The fixed-size row uses images 2, 3 and 4. */
export const FIXED_SIZES = [
  { width: 320, height: 240 },
  { width: 200, height: 200 },
  { width: 480, height: 270 },
]

/**
 * Live, fill crops follow the measured box. A measured ratio can't be
 * pre-rendered, so the static demo fixes `aspectRatio` instead.
 */
export const FILL = {
  banner: { image: 5, aspectRatio: 3 },
  frame: { image: 4, aspectRatio: 220 / 320 },
}

/** The external-image section shows the original of image 0. */
export const EXTERNAL_IMAGE = 0

export const GALLERY_SIZE ={ live: 40, static: 20 }

export const galleryRatio = (i: number, imageCount: number) =>
  RATIOS[(i * 2 + Math.floor(i / imageCount)) % RATIOS.length]!

export const heroImage = <T extends { width: number; height: number }>(images: T[]): T | undefined =>
  images.find((image) => image.width / image.height > 2) ?? images[0]

interface Source {
  src: string
  width: number
  height: number
}

export interface StaticVariantSet {
  src: string
  aspectRatio: number
  widths: number[]
}

/**
 * Every source and crop the static demo can request. Each gets the full width
 * ladder up to the source width: measured candidates, classic candidates and
 * the naive 100vw comparison are all subsets of it.
 */
export function staticVariantSets(images: Source[]): StaticVariantSet[] {
  const pick = (i: number) => images[i % images.length]!
  const uses: [Source, number][] = []
  const hero = heroImage(images)
  if (hero) uses.push([hero, HERO_RATIO])
  FIXED_SIZES.forEach(({ width, height }, i) => uses.push([pick(i + 2), width / height]))
  RATIOS.forEach(([, ratio], i) => uses.push([pick(i), ratio]))
  for (const { image, aspectRatio } of Object.values(FILL)) uses.push([pick(image), aspectRatio])
  for (let i = 0; i < GALLERY_SIZE.static; i++) uses.push([pick(i), galleryRatio(i, images.length)[1]])

  const sets = new Map<string, StaticVariantSet>()
  for (const [source, ratio] of uses) {
    const aspectRatio = snapRatio(ratio)
    const key = `${source.src} ${aspectRatio}`
    if (!sets.has(key)) {
      const widths = fullLadder({ ladder: DEFAULT_WIDTHS, srcWidth: source.width })
      sets.set(key, { src: source.src, aspectRatio, widths })
    }
  }
  return [...sets.values()]
}
