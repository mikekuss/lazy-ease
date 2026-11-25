import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLoader } from '@lazy-ease/core'
import { computeMetadata } from '@lazy-ease/server'
import type { Plugin } from 'vite'
import { ARTICLE, AVATAR, CARD, HERO } from '../src/catalog.js'
import { EXTRA_KINDS, MAIN_KINDS, TILE_SOURCES, tilesMarkup } from '../src/home/kinds.js'
import { heroMarkup, navMarkup, pairMarkup, type PrerenderOptions, type SourceMeta } from '../src/prerender.js'
import { createStaticLoader } from '../src/staticLoader.js'
import { ensureDemoImages } from './generate-images.js'

const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.join(demoDir, 'images')
// Inlined into every page, so the shared look needs no extra request (the LCP page above all).
const SITE_CSS = path.join(demoDir, 'src', 'site.css')
const SOURCES = [...new Set([HERO.mobile.src, HERO.desktop.src, ARTICLE.src, CARD.src, AVATAR.src, ...TILE_SOURCES])]

/** Metadata of the prerendered sources, read from the files (an upload or build step in a real site). */
export async function prerenderMetadata(): Promise<Map<string, SourceMeta>> {
  await ensureDemoImages(root)
  const entries = await Promise.all(
    SOURCES.map(async (src) => [src, await computeMetadata(path.join(root, src))] as const),
  )
  return new Map(entries.map(([src, { width, height, color, revision, thumbhash }]) => [src, { width, height, color, revision, thumbhash }]))
}

export function prerenderOptions(meta: Map<string, SourceMeta>, staticBase?: string): PrerenderOptions {
  return {
    loader: staticBase === undefined ? createLoader({ baseUrl: '/_img' }) : createStaticLoader({ baseUrl: `${staticBase}_img` }),
    meta: (src) => {
      const entry = meta.get(src)
      if (!entry) throw new Error(`No prerender metadata for ${src}`)
      return entry
    },
    versions: staticBase === undefined,
  }
}

/**
 * Replaces `<!--le:site-->` with the shared stylesheet, `<!--le:nav-->` with
 * the site header, and `<!--le:hero-native-->`, `<!--le:hero-fade-->` and
 * `<!--le:pair-->` with their prerendered markup, so the image sources are
 * in the response HTML itself. The static build gets static-host URLs and
 * no links to the live-only pages.
 */
export function prerender(): Plugin {
  let meta: Promise<Map<string, SourceMeta>> | undefined
  let staticBase: string | undefined
  let base = '/'
  return {
    name: 'lazy-ease-prerender',
    configResolved(config) {
      base = config.base
      staticBase = config.mode === 'static' ? config.base : undefined
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, { path: page }) {
        if (!html.includes('<!--le:')) return html
        // Read per page, so an edit shows on the next reload in development.
        const site = html.includes('<!--le:site-->') ? await readFile(SITE_CSS, 'utf8') : ''
        const current = page.replace(/^\//, '').replace(/index\.html$/, '')
        html = html
          .replace('<!--le:site-->', () => `<style>
${site}</style>`)
          .replace('<!--le:nav-->', () => navMarkup(current, base, staticBase === undefined))
        if (!/<!--le:(hero|pair|tiles)/.test(html)) return html
        const options = prerenderOptions(await (meta ??= prerenderMetadata()), staticBase)
        return html
          .replace('<!--le:hero-native-->', () => heroMarkup('native', options))
          .replace('<!--le:hero-fade-->', () => heroMarkup('fade', options))
          .replace('<!--le:pair-->', () => pairMarkup(options))
          .replace('<!--le:tiles-main-->', () => tilesMarkup(MAIN_KINDS, options.meta))
          .replace('<!--le:tiles-extra-->', () => tilesMarkup(EXTRA_KINDS, options.meta))
      },
    },
  }
}
