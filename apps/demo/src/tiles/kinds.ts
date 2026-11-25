import { parsePlaceholder, type StyleRecord } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import * as thumbhash from 'thumbhash'
import { CARD, CELLS, TRANSPARENT, type CatalogSource } from '../catalog'

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
  /** The one code line under the tile. */
  code: (meta: TileMeta) => string
  /** The placeholder in the HTML. */
  style: (meta: TileMeta) => StyleRecord | undefined
  /** A placeholder the controller paints on activation (the ThumbHash image after an SSR color). */
  placeholder?: (meta: TileMeta) => string
  reveal?: 'focus'
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

const SVG: Tile = { title: 'SVG', source: CARD, style: svg, code: () => 'thumbhashDecoder(thumbhash)' }
const PNG: Tile = { title: 'Inlined PNG', source: CARD, style: (m) => decoded(raw, m.thumbhash), code: () => 'thumbhashDecoder(thumbhash, { blur: 0 })' }
const COLOR: Tile = { title: 'Color', source: CARD, style: color, code: (m) => `placeholder="${m.color}"` }
const URI: Tile = { title: 'Own data URI', source: MEADOW, style: (m) => parsePlaceholder(gradient(m.thumbhash))?.style, code: () => 'placeholder="data:image/svg+xml,…"' }
const FOCUS: Tile = { title: 'Focus reveal', source: NIGHT, style: svg, code: () => 'reveal={focusReveal}', reveal: 'focus' }

/** Every group a page can place with `<!--le:tiles:name-->`. */
export const TILES: Record<string, Tile[]> = {
  'home-main': [SVG, PNG, COLOR],
  'home-extra': [FOCUS, URI],
  kinds: [
    SVG,
    PNG,
    COLOR,
    URI,
    { title: 'Transparent', source: TRANSPARENT, style: svg, code: () => 'ThumbHash with alpha', transparent: true },
    // Color in the server HTML, the ThumbHash image once the script runs.
    { title: 'SSR color', source: NIGHT, style: color, placeholder: (m) => `thumbhash:${m.thumbhash}`, code: () => 'thumbhashSsr="color"' },
  ],
  // Both at the page's reveal speed (the top bar), which their code lines show.
  reveals: [
    { title: 'Crossfade', source: CANYON, style: svg, code: () => 'fadeDuration={…}' },
    { ...FOCUS, source: CANYON, code: () => 'reveal={focusReveal} fadeDuration={…}' },
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

/** One group of tiles: each box with its placeholder inline and the data the page script attaches with. */
export function tilesMarkup(name: string, meta: (src: string) => TileMeta): string {
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
      ].filter(Boolean)
      const style = `aspect-ratio:${width} / ${height};${css(tile.style(m) ?? {})}`
      return `<figure class="tile${tile.transparent ? ' checker' : ''}">
  <span class="well"><span data-le ${data.join(' ')} style="${escape(style)}" title="Click to replay"></span></span>
  <figcaption><b>${tile.title}</b><code>${escape(tile.code(m))}</code></figcaption>
</figure>`
    })
    .join('\n')
}

/**
 * The start page's backdrop: the ThumbHash of the desktop hero photo, as an
 * inline SVG. It is in the first HTML and never loads anything, so it never
 * paints progressively.
 */
export const BACKDROP_SOURCE = '/meadow-haze.jpg'

export function backdropMarkup(meta: (src: string) => TileMeta): string {
  return `<span class="backdrop" aria-hidden="true" style="${escape(css(svg(meta(BACKDROP_SOURCE)) ?? {}))}"></span>`
}
