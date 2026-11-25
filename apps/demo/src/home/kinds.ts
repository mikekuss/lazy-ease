import { parsePlaceholder, type StyleRecord } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import * as thumbhash from 'thumbhash'
import { CARD, CELLS, type CatalogSource } from '../catalog'

/**
 * The placeholder tiles of the start page. The prerender plugin writes each
 * tile with its placeholder painted inline, as a server template does, so
 * the first frame already shows it; the page script only attaches the
 * images.
 */

/** What the prerender knows about a source: `computeMetadata`. */
export interface TileMeta {
  color: string
  thumbhash: string
}

interface Kind {
  id: string
  title: string
  source: CatalogSource
  /** The placeholder painted on the box. */
  style: (meta: TileMeta) => StyleRecord | undefined
  /** The one code line under the tile. */
  code: (meta: TileMeta) => string
  focus?: boolean
}

const smooth = thumbhashDecoder(thumbhash)
const raw = thumbhashDecoder(thumbhash, { blur: 0 })

/** The decoded image itself, not only the color a decoder paints first. */
const decoded = (decoder: typeof smooth, hash: string): StyleRecord | undefined => {
  const placeholder = parsePlaceholder(`thumbhash:${hash}`, decoder)
  return placeholder && { ...placeholder.style, ...placeholder.lazy?.() }
}

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
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><linearGradient id='g' x2='0' y2='1'><stop stop-color='${row(0)}'/><stop offset='1' stop-color='${row(h - 1)}'/></linearGradient><rect width='1' height='1' fill='url(#g)'/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export const MAIN_KINDS: Kind[] = [
  { id: 'svg', title: 'SVG', source: CARD, style: (m) => decoded(smooth, m.thumbhash), code: () => 'thumbhashDecoder(thumbhash)' },
  { id: 'png', title: 'Inlined PNG', source: CARD, style: (m) => decoded(raw, m.thumbhash), code: () => 'thumbhashDecoder(thumbhash, { blur: 0 })' },
  { id: 'color', title: 'Color', source: CARD, style: (m) => parsePlaceholder(m.color)?.style, code: (m) => `placeholder="${m.color}"` },
]

export const EXTRA_KINDS: Kind[] = [
  { id: 'focus', title: 'Focus reveal', source: CELLS[0]!, style: (m) => decoded(smooth, m.thumbhash), code: () => 'reveal={focusReveal}', focus: true },
  { id: 'uri', title: 'Own data URI', source: CELLS[1]!, style: (m) => parsePlaceholder(gradient(m.thumbhash))?.style, code: () => 'placeholder="data:image/svg+xml,…"' },
]

/** The sources the tiles show, for the prerender's metadata. */
export const TILE_SOURCES = [...new Set([...MAIN_KINDS, ...EXTRA_KINDS].map((kind) => kind.source.src))]

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const css = (style: StyleRecord) =>
  Object.entries(style)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(';')

/** One group of tiles, each box with its placeholder inline and the data the page script attaches with. */
export function tilesMarkup(kinds: Kind[], meta: (src: string) => TileMeta): string {
  return kinds
    .map((kind) => {
      const m = meta(kind.source.src)
      const { src, width, height } = kind.source
      const style = `aspect-ratio:${width} / ${height};${css(kind.style(m) ?? {})}`
      return `<figure class="kind">
  <span data-le data-kind="${kind.id}" data-src="${src}" data-width="${width}" data-height="${height}"${kind.focus ? ' data-focus' : ''} style="${escape(style)}"></span>
  <figcaption><b>${kind.title}</b><button type="button">↻ Replay</button><code>${escape(kind.code(m))}</code></figcaption>
</figure>`
    })
    .join('\n')
}
