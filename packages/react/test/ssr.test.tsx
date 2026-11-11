import { act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import * as thumbhash from 'thumbhash'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { candidateSet, classicCandidates, createLoader, fullLadder } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { LazyEaseProvider, type LazyEaseProviderProps } from '../src/context.js'
import { Image, type ImageProps, type ImageSource } from '../src/Image.js'
import { advance, intersect, load, resize } from './dom.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const RED = 'thumbhash:1QcSHQRnh493V4dIh4eXh1h4kJUI'
const loader = createLoader()

type Provider = Omit<LazyEaseProviderProps, 'children'>
const element = (props: Partial<ImageProps>, provider: Provider = {}) => (
  <LazyEaseProvider thumbhash={thumbhashDecoder(thumbhash)} {...provider}>
    <Image src="/a.jpg" alt="Fern" {...props} />
  </LazyEaseProvider>
)
const html = (props: Partial<ImageProps>, provider?: Provider) => renderToString(element(props, provider))
const decode = (value: string | undefined) => value?.replaceAll('&amp;', '&')
const tags = (markup: string, name: string) => markup.match(new RegExp(`<${name}[^>]*>`, 'g')) ?? []
const tag = (markup: string, name: string) => tags(markup, name)[0]!
const attr = (markup: string, name: string) => decode(markup.match(new RegExp(` ${name}="([^"]*)"`))?.[1])

/** One case per layout mode and loading path. */
const MODES: Record<string, Partial<ImageProps>> = {
  'measured fixed': { width: 320, height: 240 },
  'measured ratio': { aspectRatio: 1.5 },
  'measured fill': { fill: true },
  'measured intrinsic': { srcWidth: 1600, srcHeight: 1000 },
  'measured eager': { width: 320, height: 240, loading: 'eager' },
  'measured hard swap': { aspectRatio: 1.5, fadeDuration: 0 },
  'prepared sizes': { aspectRatio: 1.5, sizes: '50vw', srcWidth: 2400, srcHeight: 1600 },
  external: { src: 'https://other.site/a.jpg', width: 320, height: 240 },
  native: { width: 320, height: 240, loading: 'native' },
  'native intrinsic': { srcWidth: 1600, srcHeight: 1000, sizes: '100vw', loading: 'native' },
  priority: { fill: true, aspectRatio: 2, sizes: '100vw', priority: true },
  'priority focus': { fill: true, sizes: '100vw', priority: true, srcWidth: 1600, srcHeight: 500, focalPoint: { x: 70, y: 60 } },
  'external priority': { src: 'https://other.site/a.jpg', width: 320, height: 240, priority: true },
  'thumbhash measured': { width: 320, height: 240, placeholder: RED },
  'thumbhash priority': { width: 320, height: 240, placeholder: RED, priority: true },
  picture: { aspectRatio: 4 / 3, sizes: '100vw', sources: [{ media: '(min-width: 800px)', src: '/b.jpg', aspectRatio: 2, sizes: '50vw', srcWidth: 2400, srcHeight: 1600 }] },
  'picture priority': { aspectRatio: 1, sizes: '100vw', priority: true, sources: [{ media: '(min-width: 800px)', src: '/b.jpg', aspectRatio: 2 }] },
  'no-JS fallback': { width: 320, height: 240, noScript: true },
}

describe('server output', () => {
  it('renders deterministic markup for every mode', () => {
    for (const [name, props] of Object.entries(MODES)) expect(html(props), name).toBe(html(props))
  })

  it('renders deferred images with the inert source and no opacity or state', () => {
    for (const name of ['measured fixed', 'measured ratio', 'measured fill', 'measured intrinsic', 'measured eager', 'prepared sizes', 'external']) {
      const markup = html(MODES[name]!)
      const img = tag(markup, 'img')
      expect(attr(img, 'src'), name).toBe(INERT)
      expect(img, name).not.toMatch(/ srcset=| sizes=/i)
      expect(markup, name).not.toContain('opacity')
      expect(markup, name).not.toContain('data-state')
      expect(markup, name).toContain('data-le-auto="off"')
    }
  })

  it('renders native images with their real sources, visible from the first paint', () => {
    const native = tag(html(MODES.native!), 'img')
    expect(attr(native, 'loading')).toBe('lazy')
    // Without source dimensions nothing is known about the outputs: one URL for the largest request.
    expect(attr(native, 'src')).toBe(loader.url({ src: '/a.jpg', width: 640, aspectRatio: 1.333, quality: 75, format: 'webp' }))
    expect(native).not.toMatch(/srcSet|sizes/)
    const sized = tag(html({ ...MODES.native, srcWidth: 2400, srcHeight: 1600 }), 'img')
    const expected = candidateSet({
      widths: classicCandidates({ width: 320, ladder: loader.widths, srcWidth: 2400 }),
      srcWidth: 2400,
      srcHeight: 1600,
      loader,
      src: '/a.jpg',
      aspectRatio: 1.333,
      quality: 75,
      format: 'webp',
    })
    expect(attr(sized, 'srcSet')).toBe(expected.srcset)
    expect(attr(sized, 'sizes')).toBe('320px')
    const priority = tag(html(MODES.priority!), 'img')
    expect(attr(priority, 'fetchPriority')).toBe('high')
    expect(priority).not.toContain('loading=')
    expect(html(MODES.priority!)).not.toContain('opacity')
  })

  it('puts the oriented source ratio on an intrinsic image without a width', () => {
    const img = tag(html(MODES['native intrinsic']!), 'img')
    expect(img).toContain('aspect-ratio:1600 / 1000')
    expect(attr(img, 'width')).toBe('1600')
    expect(attr(img, 'height')).toBe('1000')
  })

  it('crops a fill image in the browser by default when the source size is known', () => {
    const markup = html(MODES['priority focus']!)
    expect(attr(tag(markup, 'img'), 'srcSet')).not.toContain('ar=')
    expect(markup).toContain('container-type:size')
    expect(markup).toContain('object-position:clamp(')
    // A declared ratio is a server crop around the focal point.
    expect(attr(tag(html({ ...MODES['priority focus'], aspectRatio: 2 }), 'img'), 'srcSet')).toContain('ar=2&fmt=webp&fx=70&fy=60&')
  })

  it('writes token and version into native URLs', () => {
    const src = attr(tag(html({ ...MODES.native, token: '1.k1.abc', version: 'r7' }), 'img'), 'src')
    expect(src).toContain('q=75&token=1.k1.abc&v=r7&w=640')
  })

  it('uses WebP, or auto for loaders with formats: auto', () => {
    const src = (provider: Provider) => attr(tag(html(MODES.native!, provider), 'img'), 'src')
    expect(src({ loader: createLoader({ qualities: [60] }) })).toContain('fmt=webp&q=60')
    expect(src({ loader: { ...createLoader(), formats: 'auto' } })).toContain('fmt=auto')
    expect(src({ loader: { ...createLoader(), formats: ['jpeg'] } })).toContain('fmt=jpeg')
  })

  it('renders only the average color of a ThumbHash unless opted in', () => {
    expect(html(MODES['thumbhash measured']!)).not.toContain('background-image')
    expect(html(MODES['thumbhash measured']!, { thumbhashSsr: 'image' })).toContain('background-image:url(&quot;data:image/png')
    expect(html(MODES['thumbhash priority']!)).toContain('background-image:url(&quot;data:image/png')
  })
})

describe('breakpoint sources', () => {
  const desktop: ImageSource = { media: '(min-width: 800px)', src: '/b.jpg', aspectRatio: 2, srcWidth: 2400, srcHeight: 1600, focalPoint: { x: 65, y: 40 }, sizes: '50vw', token: 't2' }

  it('renders native sources with their own crop, focus, token and slot', () => {
    const markup = html({ aspectRatio: 1, sizes: '100vw', loading: 'native', sources: [desktop] })
    const source = tag(markup, 'source')
    expect(markup).toMatch(/<picture><source[^>]*><img/)
    expect(attr(source, 'media')).toBe('(min-width: 800px)')
    expect(attr(source, 'sizes')).toBe('50vw')
    const expected = candidateSet({
      widths: fullLadder({ ladder: loader.widths, srcWidth: 2400 }),
      srcWidth: 2400,
      srcHeight: 1600,
      loader,
      src: '/b.jpg',
      aspectRatio: 2,
      focalPoint: { x: 65, y: 40 },
      quality: 75,
      format: 'webp',
      token: 't2',
    })
    expect(attr(source, 'srcSet')).toBe(expected.srcset)
  })

  it('defers the sources of a deferred picture', () => {
    const markup = html(MODES.picture!)
    const source = tag(markup, 'source')
    expect(source).not.toMatch(/ srcset=/i)
    expect(attr(source, 'data-le-sizes')).toBe('50vw')
    expect(attr(source, 'data-le-srcset')).toContain('/_img/b.jpg?ar=2&')
  })

  it('leaves the ratio to CSS through --le-ar', () => {
    expect(html(MODES.picture!)).toContain('aspect-ratio:var(--le-ar, 1.3333333333333333)')
  })
})

describe('priority preload', () => {
  const preloads = (markup: string) => tags(markup, 'link').filter((link) => link.includes('rel="preload"'))

  it('emits one preload built from the same strings as the img, with its credentials', () => {
    const markup = html({ ...MODES.priority, srcWidth: 2400, srcHeight: 1600, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' })
    const links = preloads(markup)
    expect(links).toHaveLength(1)
    const img = tag(markup, 'img')
    expect(attr(links[0]!, 'imageSrcSet')).toBe(attr(img, 'srcSet'))
    expect(attr(links[0]!, 'imageSizes')).toBe(attr(img, 'sizes'))
    expect(attr(links[0]!, 'fetchPriority')).toBe('high')
    expect(attr(links[0]!, 'crossorigin') ?? attr(links[0]!, 'crossOrigin')).toBe('')
    expect(attr(links[0]!, 'referrerPolicy')).toBe('no-referrer')
  })

  it('preloads only the first source of a picture, under its media query', () => {
    const markup = html({ ...MODES['picture priority'], crossOrigin: 'use-credentials' })
    const links = preloads(markup)
    expect(links).toHaveLength(1)
    const source = tag(markup, 'source')
    expect(attr(links[0]!, 'media')).toBe('(min-width: 800px)')
    expect(attr(links[0]!, 'imageSrcSet')).toBe(attr(source, 'srcSet'))
    expect(attr(links[0]!, 'imageSizes')).toBe(attr(source, 'sizes'))
    expect(attr(links[0]!, 'crossorigin') ?? attr(links[0]!, 'crossOrigin')).toBe('use-credentials')
  })

  it('preloads an external priority image by href, and nothing without priority', () => {
    const links = preloads(html(MODES['external priority']!))
    expect(links).toHaveLength(1)
    expect(attr(links[0]!, 'href')).toBe('https://other.site/a.jpg')
    expect(preloads(html(MODES.native!))).toHaveLength(0)
  })
})

describe('hydration', () => {
  let root: Root | undefined

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  async function hydrate(tree: ReactElement) {
    const container = document.createElement('div')
    container.innerHTML = renderToString(tree)
    document.body.append(container)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: recoverable })
    })
    const img = container.querySelector('img')!
    return { container, img, owner: img.closest<HTMLElement>('[data-le]')!, errors, recoverable }
  }

  for (const [name, props] of Object.entries(MODES)) {
    it(`hydrates ${name} without a mismatch`, async () => {
      const { errors, recoverable } = await hydrate(element(props))
      await advance()
      expect(errors).not.toHaveBeenCalled()
      expect(recoverable).not.toHaveBeenCalled()
    })
  }

  it('attaches deferred images after hydration and loads them', async () => {
    const onLoad = vi.fn()
    const { owner, img } = await hydrate(element({ width: 320, height: 240, onLoad }, { loader: createLoader({ formats: ['webp'] }) }))
    expect(owner.dataset.state).toBe('idle')
    intersect(owner)
    resize(owner, 320, 240)
    expect(img.getAttribute('src')).toContain('/_img/a.jpg?ar=1.333&fmt=webp&q=75&w=640')
    load(img)
    await advance()
    expect(owner.dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('keeps native images and their server sources through hydration', async () => {
    const tree = element({ width: 320, height: 240, priority: true, srcWidth: 2400, srcHeight: 1600 })
    const srcset = attr(tag(renderToString(tree), 'img'), 'srcSet')
    const { img } = await hydrate(tree)
    await advance(1000)
    expect(img.getAttribute('srcset')).toBe(srcset)
    expect(img.style.opacity).toBe('')
    expect(img.getAttribute('data-state')).toBe('loading')
  })

  it('reports a native image that failed before hydration as an error', async () => {
    const tree = element({ width: 320, height: 240, loading: 'native', wrapperClassName: 'box' })
    const container = document.createElement('div')
    container.innerHTML = renderToString(tree)
    document.body.append(container)
    Object.assign(container.querySelector('img')!, { complete: true, naturalWidth: 0 })
    await act(async () => {
      root = hydrateRoot(container, tree)
    })
    expect(container.querySelector<HTMLElement>('.box')!.dataset.state).toBe('error')
  })

  it('calls onLoad for a native image that loads after hydration', async () => {
    const onLoad = vi.fn()
    const { img } = await hydrate(element({ width: 320, height: 240, priority: true, onLoad }))
    load(img)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(img.dataset.state).toBe('loaded')
  })
})
