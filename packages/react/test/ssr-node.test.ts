// Server rendering outside jsdom, with every browser global a trap.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LazyEaseProvider } from '../src/context.js'
import { Image, type ImageProps } from '../src/Image.js'

const BROWSER_GLOBALS = [
  'window',
  'document',
  'matchMedia',
  'devicePixelRatio',
  'IntersectionObserver',
  'ResizeObserver',
  'Image',
  'HTMLElement',
  'HTMLImageElement',
]

const CASES: Partial<ImageProps>[] = [
  { width: 320, height: 240 },
  { aspectRatio: 1.5 },
  { fill: true },
  { width: 300 },
  { width: 320, height: 240, loading: 'eager' },
  { src: 'https://other.site/a.jpg', width: 320, height: 240 },
  { aspectRatio: 1.5, sizes: '50vw' },
  { width: 320, height: 240, loading: 'native' },
  { fill: true, aspectRatio: 2, sizes: '100vw', priority: true },
  { width: 320, height: 240, placeholder: 'thumbhash:1QcSHQRnh493V4dIh4eXh1h4kJUI' },
  { width: 320, height: 240, priority: true, placeholder: 'thumbhash:1QcSHQRnh493V4dIh4eXh1h4kJUI' },
]

describe('server rendering without a DOM', () => {
  const touched: string[] = []

  beforeAll(() => {
    for (const name of BROWSER_GLOBALS) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name)
          throw new Error(`${name} read during server render`)
        },
      })
    }
  })

  afterAll(() => {
    for (const name of BROWSER_GLOBALS) delete (globalThis as Record<string, unknown>)[name]
  })

  it('reads no browser global in any mode', () => {
    for (const props of CASES) {
      const element = createElement(Image, { src: '/a.jpg', alt: '', ...props })
      const markup = renderToString(createElement(LazyEaseProvider, { thumbhashSsr: 'image', children: element }))
      expect(markup, JSON.stringify(props)).toContain('<img')
      expect(renderToString(element)).toContain('<img')
    }
    expect(touched).toEqual([])
  })
})
