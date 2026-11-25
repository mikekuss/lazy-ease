import { parsePlaceholder, type StyleRecord } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import * as thumbhash from 'thumbhash'
import { CARD, CELLS, TRANSPARENT, type CatalogSource } from '../catalog'
import { DEMO_FADE } from '../prerender'

/**
 * The demo tiles of the start and placeholders pages. The prerender plugin
 * writes each tile with its placeholder painted inline, as a server template
 * does, so the first frame already shows it; src/tiles/main.ts only attaches
 * the images. Every tile is one public option of the library.
 */

/** What the prerender knows about a source: `computeMetadata`. */
export interface TileMeta {
  color: string
  thumbhash: string
}

export interface Tile {
  title: string
  source: CatalogSource
  /** The one short code line under the tile: React, and the HTML a template writes where it has one. */
  code: (meta: TileMeta) => { react: string; html?: string }
  /** The placeholder in the HTML. */
  style: (meta: TileMeta) => StyleRecord | undefined
  /** A placeholder the controller paints on activation (the ThumbHash image after an SSR color). */
  placeholder?: (meta: TileMeta) => string
  reveal?: 'focus'
  /** Native sources in the HTML, high priority, no fade. */
  priority?: boolean
  /** The placeholder stands for a transparent image, so it fades out with the fade. */
  transparent?: boolean
}

const smooth = thumbhashDecoder(thumbhash)
const raw = thumbhashDecoder(thumbhash, { blur: 0 })

/** The decoded image itself, not only the color a decoder paints first. */
const decoded = (decoder: typeof smooth, hash: string): StyleRecord | undefined => {
  const placeholder = parsePlaceholder(`thumbhash:${hash}`, decoder)
  return placeholder && { ...placeholder.style, ...placeholder.lazy?.() }
}
const svg = (m: TileMeta) => decoded(smooth, m.thumbhash)
const color = (m: TileMeta) => parsePlaceholder(m.color)?.style

/**
 * A custom data URI: a vertical gradient between the top and bottom colors
 * of the ThumbHash, as a template could write it ahead of time.
 */
function gradient(hash: string): string {
  const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
  const { w, h, rgba } = thumbhash.thumbHashToRGBA(bytes)
  const row = (y: number) => {
    const sum = [0, 0, 0]
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) sum[c]! += rgba[(y * w + x) * 4 + c]!
    return `rgb(${sum.map((v) => Math.round(v / w)).join(' ')})`
  }
  const image = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><linearGradient id='g' x2='0' y2='1'><stop stop-color='${row(0)}'/><stop offset='1' stop-color='${row(h - 1)}'/></linearGradient><rect width='1' height='1' fill='url(#g)'/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(image)}`
}

const [CANYON, MEADOW, NIGHT] = CELLS as [CatalogSource, CatalogSource, CatalogSource, CatalogSource]

const SVG: Tile = { title: 'SVG', source: CARD, style: svg, code: () => ({ react: 'thumbhashDecoder(…)', html: 'background-image:url(svg)' }) }
const PNG: Tile = { title: 'Inlined PNG', source: CARD, style: (m) => decoded(raw, m.thumbhash), code: () => ({ react: '{ blur: 0 }', html: 'background-image:url(png)' }) }
const COLOR: Tile = { title: 'Color', source: CARD, style: color, code: (m) => ({ react: `placeholder="${m.color}"`, html: `background-color:${m.color}` }) }
const URI: Tile = { title: 'Own data URI', source: MEADOW, style: (m) => parsePlaceholder(gradient(m.thumbhash))?.style, code: () => ({ react: 'placeholder="data:…"', html: 'background:url(data:…)' }) }
const FOCUS: Tile = { title: 'Focus reveal', source: NIGHT, style: svg, code: () => ({ react: 'reveal={focusReveal}', html: 'reveal: focusReveal' }), reveal: 'focus' }

/** Every group a page can place with `<!--le:tiles:name-->`. */
export const TILES: Record<string, Tile[]> = {
  'home-main': [SVG, PNG, COLOR],
  'home-extra': [FOCUS, URI],
  kinds: [
    SVG,
    PNG,
    COLOR,
    URI,
    { title: 'Transparent', source: TRANSPARENT, style: svg, code: () => ({ react: 'placeholder="thumbhash:…"', html: 'background-image:url(svg)' }), transparent: true },
    // No placeholder: the fade alone.
    { title: 'None', source: NIGHT, style: () => ({}), code: () => ({ react: 'placeholder="none"', html: 'no background' }) },
  ],
  // What React writes into the server HTML before hydration.
  ssr: [
    { title: 'SSR image', source: NIGHT, style: svg, code: () => ({ react: 'thumbhashSsr="image"' }) },
    // Color in the server HTML, the ThumbHash image once the script runs.
    { title: 'SSR color', source: NIGHT, style: color, placeholder: (m) => `thumbhash:${m.thumbhash}`, code: () => ({ react: 'thumbhashSsr="color"' }) },
  ],
  // Both at the page's reveal speed (the top bar), which their code lines show.
  reveals: [
    { title: 'Crossfade', source: CANYON, style: svg, code: () => ({ react: `fadeDuration={${DEMO_FADE}}`, html: `fadeDuration: ${DEMO_FADE}` }) },
    { ...FOCUS, source: CANYON },
    // For the image that is the LCP: the browser's own loading, no fade.
    { title: 'Priority', source: CANYON, style: svg, code: () => ({ react: 'priority', html: 'fetchpriority="high"' }), priority: true },
  ],
}

/** The sources the tiles show, for the prerender's metadata. */
export const TILE_SOURCES = [...new Set(Object.values(TILES).flat().map((tile) => tile.source.src))]

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const css = (style: StyleRecord) =>
  Object.entries(style)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(';')

/** The code lines of a tile: one per flavor, or one without tabs where only React has it. */
const codeLines = ({ react, html }: { react: string; html?: string }) =>
  html === undefined
    ? `<code title="${escape(react)}">${escape(react)}</code>`
    : `<code class="flavor-react" title="${escape(react)}">${escape(react)}</code><code class="flavor-html" title="${escape(html)}">${escape(html)}</code>`

/** One group of tiles: each box with its placeholder inline and the data the page script attaches with. */
export function tilesMarkup(name: string, meta: (src: string) => TileMeta, native: (src: string) => { src: string; srcset?: string }): string {
  const tiles = TILES[name]
  if (!tiles) throw new Error(`No tile group ${name}`)
  return tiles
    .map((tile) => {
      const m = meta(tile.source.src)
      const { src, width, height } = tile.source
      const data = [
        `data-src="${src}" data-width="${width}" data-height="${height}"`,
        tile.placeholder ? `data-placeholder="${escape(tile.placeholder(m))}"` : '',
        tile.reveal ? `data-reveal="${tile.reveal}"` : '',
        tile.transparent ? 'data-transparent' : '',
        tile.priority ? 'data-priority' : '',
      ].filter(Boolean)
      // A priority tile has its sources in the HTML, as for the LCP image.
      const set = tile.priority ? native(src) : undefined
      const img = set
        ? `<img alt="" width="${width}" height="${height}" src="${escape(set.src)}" srcset="${escape(set.srcset ?? set.src)}" sizes="(min-width: 900px) 33vw, 100vw" fetchpriority="high" decoding="async">`
        : ''
      // Every tile is 3:2 (the well); the image fills it, cropped in the browser.
      const style = css(tile.style(m) ?? {})
      // The placeholder once more, small and for good, so it can be compared with the image after the reveal.
      const swatch = `<span class="swatch" aria-hidden="true" title="The placeholder" style="${escape(style)}"></span>`
      return `<figure class="tile${tile.transparent ? ' checker' : ''}">
  <span class="well"><span data-le ${data.join(' ')} style="${escape(style)}" title="Click to replay">${img}</span></span>
  <figcaption><span class="cap">${swatch}<b>${tile.title}</b></span>${codeLines(tile.code(m))}</figcaption>
</figure>`
    })
    .join('\n')
}

/**
 * The intro's backdrop: the photo's ThumbHash inline, as a server template
 * writes it, so it is there from the first frame. The page script attaches
 * the photo, which fades in once after decode (no priority, so it never
 * paints in steps).
 */
export const BACKDROP_SOURCE = '/meadow-haze.jpg'
const BACKDROP = MEADOW

export function backdropMarkup(meta: (src: string) => TileMeta): string {
  const { src, width, height } = BACKDROP
  return `<span class="backdrop" aria-hidden="true"><span data-le data-src="${src}" data-width="${width}" data-height="${height}" style="${escape(css(svg(meta(BACKDROP_SOURCE)) ?? {}))}"></span></span>`
}
