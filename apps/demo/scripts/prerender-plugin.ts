import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLoader } from '@lazy-ease/core'
import { computeMetadata } from '@lazy-ease/server'
import type { Plugin } from 'vite'
import { ARTICLE, AVATAR, CARD, HERO } from '../src/catalog.js'
import { heroMarkup, pairMarkup, type PrerenderOptions, type SourceMeta } from '../src/prerender.js'
import { createStaticLoader } from '../src/staticLoader.js'
import { ensureDemoImages } from './generate-images.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'images')
const SOURCES = [HERO.mobile.src, HERO.desktop.src, ARTICLE.src, CARD.src, AVATAR.src]

/** Metadata of the prerendered sources, read from the files (an upload or build step in a real site). */
export async function prerenderMetadata(): Promise<Map<string, SourceMeta>> {
  await ensureDemoImages(root)
  const entries = await Promise.all(
    SOURCES.map(async (src) => [src, await computeMetadata(path.join(root, src))] as const),
  )
  return new Map(entries.map(([src, { width, height, color, revision }]) => [src, { width, height, color, revision }]))
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
 * Replaces `<!--le:hero-native-->`, `<!--le:hero-fade-->` and `<!--le:pair-->`
 * in the HTML pages with their prerendered markup, so the image sources are
 * in the response HTML itself. The static build gets static-host URLs.
 */
export function prerender(): Plugin {
  let meta: Promise<Map<string, SourceMeta>> | undefined
  let staticBase: string | undefined
  return {
    name: 'lazy-ease-prerender',
    configResolved(config) {
      staticBase = config.mode === 'static' ? config.base : undefined
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        if (!html.includes('<!--le:')) return html
        const options = prerenderOptions(await (meta ??= prerenderMetadata()), staticBase)
        return html
          .replace('<!--le:hero-native-->', () => heroMarkup('native', options))
          .replace('<!--le:hero-fade-->', () => heroMarkup('fade', options))
          .replace('<!--le:pair-->', () => pairMarkup(options))
      },
    },
  }
}
