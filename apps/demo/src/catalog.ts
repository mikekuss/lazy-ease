import type { FocalPoint } from '@lazy-ease/core'

/**
 * The sources of the recipe cases (docs/image-recipes.md) and the crops the
 * demo server admits for them. Shared by the server's policy, the prerendered
 * pages, the React recipes page and the static build, so all of them agree.
 * Dimensions are those scripts/generate-images.ts renders.
 */

export interface Crop {
  aspectRatio: number
  focalPoint?: FocalPoint
}

export interface CatalogSource {
  src: string
  width: number
  height: number
}

const source = (src: string, width: number, height: number): CatalogSource => ({ src, width, height })

/** Mobile: square crop of one original. Desktop (800px and up): wide crop of another. */
export const HERO = {
  alt: 'Mountains at dawn',
  media: '(min-width:800px)',
  mobile: { ...source('/alpine-dawn.jpg', 3000, 2000), crop: { aspectRatio: 1, focalPoint: { x: 30, y: 45 } } },
  desktop: { ...source('/desert-dusk.jpg', 3360, 1440), crop: { aspectRatio: 2, focalPoint: { x: 65, y: 40 } } },
  sizes: '100vw',
} as const

/** 56 px square with the CMS focus. */
export const AVATAR = { ...source('/misty-pines.jpg', 1600, 2400), size: 56, focalPoint: { x: 40, y: 30 } }
/** A 40 px original: one URL, whatever the slot. */
export const TINY = source('/extra/tiny.jpg', 40, 40)
/** Fixed 320 × 240 card, centered 4:3 crop. */
export const CARD = source('/glacier-noon.jpg', 3000, 2000)
/** One source, 4:3 below 800px, 2:1 above. */
export const SPLIT = source('/blue-ridge.jpg', 3000, 2000)
/** Measured image in a resizable frame. */
export const GROW = source('/violet-peaks.jpg', 2400, 2400)
/** Fill gallery cells, browser crop of the uncropped ladder. */
export const CELLS = [
  source('/ember-canyon.jpg', 1600, 2400),
  source('/meadow-haze.jpg', 2400, 2400),
  source('/northern-night.jpg', 3000, 2000),
  source('/starfield.jpg', 3360, 1440),
]
/** Native article image with intrinsic ratio. */
export const ARTICLE = source('/northern-night.jpg', 3000, 2000)
export const ARTICLE_SIZES = '(min-width:720px) 720px, 100vw'
/** Decorative banner, `image-set()` gated on visibility. */
export const BANNER = { ...source('/starfield.jpg', 3360, 1440), aspectRatio: 2 }
/** A PNG with alpha, for the transparent placeholder. */
export const TRANSPARENT = source('/extra/disc.png', 1600, 1000)
export const LOGO = '/extra/logo.svg'
export const WAVE = '/extra/wave.gif'
/** Signed-in viewers only (live). 128 px square, admitted by crop token. */
export const PRIVATE = { ...source('/private/fern.jpg', 1600, 1200), size: 128 }
/** A crop the server does not admit: another focus without a token. */
export const DENIED: Crop = { aspectRatio: 1, focalPoint: { x: 80, y: 20 } }

/** Crops the server admits beyond the default uncropped and centered ladder crops. */
export const EXTRA_CROPS: Record<string, Crop[]> = {
  [HERO.mobile.src]: [HERO.mobile.crop],
  [HERO.desktop.src]: [HERO.desktop.crop],
  [AVATAR.src]: [{ aspectRatio: 1, focalPoint: AVATAR.focalPoint }],
}

/** Private sources: no tokenless crop, so their square needs the token. */
export const isPrivate = (path: string) => path.startsWith('/private/')
