import { act, render } from '@testing-library/react'
import { StrictMode, Suspense, createRef, startTransition, use, useLayoutEffect, useState, type ReactNode, type SyntheticEvent } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import * as thumbhash from 'thumbhash'
import { describe, expect, it, vi } from 'vitest'
import { candidateSet, classicCandidates, createLazyEase, createLoader, detectAvif, focusReveal, fullLadder, measuredCandidates, snapRatio, type LoadState } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import * as core from '../../core/test/dom-mocks.js'
import { enhance } from '../../vanilla/src/index.js'
import { LazyEaseProvider, type LazyEaseProviderProps } from '../src/context.js'
import { Image, type ImageProps } from '../src/Image.js'
import { MockIntersectionObserver, MockResizeObserver, advance, complete, decoding, fail, intersect, load, media, resize } from './dom.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const CLAIM = Symbol.for('lazy-ease.attachment')
const webp = createLoader({ formats: ['webp'] })

function solidThumbHash(r: number, g: number, b: number): string {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, 255], i)
  return btoa(String.fromCharCode(...thumbhash.rgbaToThumbHash(8, 8, rgba)))
}
const RED = `thumbhash:${solidThumbHash(255, 0, 0)}`
const decoder = thumbhashDecoder(thumbhash)

type Provider = Omit<LazyEaseProviderProps, 'children'>

function tree(props: Partial<ImageProps>, provider: Provider = {}): ReactNode {
  return (
    <LazyEaseProvider loader={webp} {...provider}>
      <Image src="/a.jpg" alt="Fern" {...props} />
    </LazyEaseProvider>
  )
}

/** Renders one image; `owner` is its marked box, or the img itself when it has none. */
function mount(props: Partial<ImageProps>, provider?: Provider) {
  const result = render(tree(props, provider))
  const img = () => result.container.querySelector('img')!
  const owner = () => img().closest<HTMLElement>('[data-le]')!
  return { ...result, img, owner, rerender: (next: Partial<ImageProps>) => result.rerender(tree({ ...props, ...next }, provider)) }
}

const observed = (element: Element) => MockIntersectionObserver.instances.some((o) => o.elements.has(element))
const claimed = (img: HTMLImageElement) => (img as unknown as Record<symbol, unknown>)[CLAIM] !== undefined

describe('markup and wrappers', () => {
  it('renders a marked box per layout mode, kept out of the vanilla scan', () => {
    const boxStyle = (props: Partial<ImageProps>) => {
      const { owner, img } = mount(props)
      expect(owner().tagName).toBe('SPAN')
      expect(owner().getAttribute('data-le')).toBe('')
      expect(owner().getAttribute('data-le-auto')).toBe('off')
      expect(img().hasAttribute('data-le')).toBe(false)
      return owner().style
    }
    expect(boxStyle({ width: 320, height: 240 })).toMatchObject({ width: '320px', maxWidth: '100%', aspectRatio: '320 / 240' })
    expect(boxStyle({ aspectRatio: 1.5 })).toMatchObject({ width: '100%', aspectRatio: '1.5 / 1' })
    expect(boxStyle({ fill: true })).toMatchObject({ position: 'absolute', inset: '0px' })
    expect(boxStyle({ width: 300 })).toMatchObject({ width: '300px', aspectRatio: '' })
  })

  it('covers the box with the img, except in intrinsic mode without a ratio', () => {
    expect(mount({ fill: true }).img().style).toMatchObject({ width: '100%', height: '100%', objectFit: 'cover' })
    expect(mount({ width: 300 }).img().style).toMatchObject({ width: '100%', height: 'auto', objectFit: '' })
  })

  it('renders a bare img where nothing needs a box', () => {
    const native = mount({ width: 320, height: 240, loading: 'native', placeholder: '#123456' })
    expect(native.container.querySelector('span')).toBeNull()
    expect(native.owner()).toBe(native.img())
    expect(native.img().getAttribute('data-le-auto')).toBe('off')
    expect(native.img().style).toMatchObject({ width: '320px', maxWidth: '100%', height: 'auto', aspectRatio: '320 / 240', backgroundColor: 'rgb(18, 52, 86)' })
    // A deferred image without a fade swaps hard, so it needs no box either.
    const hard = mount({ aspectRatio: 2, fadeDuration: 0 })
    expect(hard.container.querySelectorAll('span')).toHaveLength(0)
    intersect(hard.img())
    resize(hard.img(), 400, 200)
    expect(hard.img().getAttribute('src')).toContain('/_img/a.jpg?ar=2&fmt=webp&q=75&w=')
    expect(hard.img().style.opacity).toBe('')
  })

  it('keeps the box for wrapper props, focal positioning and fill', () => {
    const wrapped = mount({ width: 320, height: 240, loading: 'native', wrapperClassName: 'card', wrapperStyle: { padding: 4 } })
    expect(wrapped.owner().tagName).toBe('SPAN')
    expect(wrapped.owner().className).toBe('card')
    expect(wrapped.owner().style.padding).toBe('4px')
    const focused = mount({ fill: true, sizes: '100vw', priority: true, srcWidth: 1600, srcHeight: 500, focalPoint: { x: 70, y: 60 } })
    expect(focused.owner().style.containerType).toBe('size')
    expect(focused.img().style.objectPosition).toContain('clamp(')
  })

  it('reserves the intrinsic ratio from the source dimensions without a width', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { owner, img } = mount({ srcWidth: 1600, srcHeight: 1000, loading: 'native', sizes: '100vw' })
    expect(owner()).toBe(img())
    expect(img().style).toMatchObject({ width: '100%', height: 'auto', aspectRatio: '1600 / 1000', objectFit: 'cover' })
    expect(img().getAttribute('width')).toBe('1600')
    expect(img().getAttribute('height')).toBe('1000')
    const boxed = mount({ srcWidth: 1600, srcHeight: 1000 })
    expect(boxed.owner().style.aspectRatio).toBe('1600 / 1000')
    expect(warn).not.toHaveBeenCalled()
    mount({ src: '/no-size.jpg', width: 300 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/no-size.jpg has no height to reserve'))
  })

  it('throws in development for invalid combinations', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const props of [
      { height: 200 },
      { fill: true, width: 300 },
      { width: 300, height: 200, aspectRatio: 1 },
      { fill: true, crop: 'browser' as const },
      { priority: true, aspectRatio: 2 },
      { loading: 'native' as const, aspectRatio: 2 },
    ]) {
      expect(() => mount(props), JSON.stringify(props)).toThrow('[lazy-ease]')
    }
  })

  it('does not hide a ReferenceError from inside the development checks', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      throw new ReferenceError('bug in a check')
    })
    expect(() => mount({ width: 320, height: 240 })).toThrow('bug in a check')
  })

  it('forwards ref to the img', () => {
    const object = createRef<HTMLImageElement>()
    const { img, unmount } = mount({ width: 320, height: 240, ref: object })
    expect(object.current).toBe(img())
    const callback = vi.fn()
    mount({ width: 320, height: 240, ref: callback })
    expect(callback).toHaveBeenCalledWith(expect.any(HTMLImageElement))
    unmount()
    expect(object.current).toBeNull()
  })
})

describe('deferred images', () => {
  it('shows the inert placeholder until the box intersects, then installs measured candidates', () => {
    const { owner, img } = mount({ width: 320, height: 240, srcWidth: 2400, srcHeight: 1600 })
    expect(img().getAttribute('src')).toBe(INERT)
    expect(img().hasAttribute('srcset')).toBe(false)
    expect(owner().dataset.state).toBe('idle')
    intersect(owner())
    resize(owner(), 320, 240)
    const expected = candidateSet({
      widths: measuredCandidates({ measuredWidth: 320, ladder: webp.widths, srcWidth: 2400 }),
      srcWidth: 2400,
      srcHeight: 1600,
      loader: webp,
      src: '/a.jpg',
      aspectRatio: snapRatio(320 / 240, webp.ratios),
      quality: 75,
      format: 'webp',
    })
    expect(img().getAttribute('sizes')).toBe('320px')
    expect(img().getAttribute('srcset')).toBe(expected.srcset)
    expect(img().style.opacity).toBe('0')
    expect(owner().dataset.state).toBe('loading')
  })

  it('fades in after load and decode, and calls onLoad once with the React event', async () => {
    let target: EventTarget | null = null
    const onLoad = vi.fn((event: SyntheticEvent<HTMLImageElement>) => (target = event.currentTarget))
    const states: LoadState[] = []
    const { owner, img } = mount({ width: 320, height: 240, fadeDuration: 300, onLoad, onStateChange: (state) => states.push(state) })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    expect(img().style.opacity).toBe('0')
    await advance()
    expect(img().style).toMatchObject({ opacity: '1', transition: 'opacity 300ms ease-out' })
    expect(owner().dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(1)
    const event = onLoad.mock.calls[0]![0]
    expect(event.type).toBe('load')
    expect(event.nativeEvent).toBeInstanceOf(Event)
    expect(target).toBe(img())
    expect(states).toEqual(['idle', 'loading', 'loaded'])
    // The placeholder goes after the fade, so transparent images don't show it.
    expect(owner().style.backgroundColor).not.toBe('')
    await advance(300)
    expect(owner().style.backgroundColor).toBe('')
    expect(img().style.opacity).toBe('')
    // An upgrade neither fades nor calls onLoad again.
    resize(owner(), 320, 240)
    load(img())
    await advance(500)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['idle', 'loading', 'loaded'])
  })

  it('swaps directly with reduced motion', async () => {
    media.reducedMotion = true
    const { owner, img } = mount({ width: 320, height: 240 })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance()
    expect(img().style.opacity).toBe('')
    expect(owner().style.backgroundColor).toBe('')
  })

  it('prepares the candidates for sizes and still fades', async () => {
    const { owner, img } = mount({ aspectRatio: 1.5, sizes: '(min-width: 800px) 50vw, 100vw', srcWidth: 2400, srcHeight: 1600 })
    expect(img().getAttribute('src')).toBe(INERT)
    expect(img().hasAttribute('sizes')).toBe(false)
    intersect(owner())
    const expected = candidateSet({
      widths: fullLadder({ ladder: webp.widths, srcWidth: 2400 }),
      srcWidth: 2400,
      srcHeight: 1600,
      loader: webp,
      src: '/a.jpg',
      aspectRatio: 1.5,
      quality: 75,
      format: 'webp',
    })
    expect(img().getAttribute('srcset')).toBe(expected.srcset)
    expect(img().getAttribute('sizes')).toBe('(min-width: 800px) 50vw, 100vw')
    expect(img().getAttribute('src')).toBe(expected.src)
    expect(img().style.opacity).toBe('0')
    // Prepared candidates need no measuring.
    expect(MockResizeObserver.instances.some((o) => o.elements.size > 0)).toBe(false)
    load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
  })

  it('shows a loaded image after the decode timeout when decode never settles', async () => {
    decoding.behavior = 'hang'
    const onLoad = vi.fn()
    const { owner, img } = mount({ width: 320, height: 240, onLoad })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance(249)
    expect(img().style.opacity).toBe('0')
    expect(onLoad).not.toHaveBeenCalled()
    await advance(1)
    expect(img().style.opacity).toBe('1')
    expect(owner().dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('ignores a decode that settles after a newer source was set', async () => {
    let finish!: () => void
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    const { owner, img } = mount({ aspectRatio: 1.5, srcWidth: 2400, srcHeight: 1600 })
    intersect(owner())
    resize(owner(), 300, 200)
    load(img())
    // Grows past the next candidate before the first decode finishes; the browser starts on it.
    resize(owner(), 900, 600)
    await advance(200)
    Object.assign(img(), { currentSrc: img().getAttribute('src') })
    finish()
    await advance()
    expect(img().style.opacity).toBe('0')
    load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
  })

  it('releases the placeholder and reports an error when the first load fails', async () => {
    const onError = vi.fn()
    const states: LoadState[] = []
    const { owner, img } = mount({ width: 320, height: 240, onError, onStateChange: (state) => states.push(state) })
    intersect(owner())
    resize(owner(), 320, 240)
    fail(img())
    expect(owner().dataset.state).toBe('error')
    expect(states.at(-1)).toBe('error')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(owner().style.backgroundColor).toBe('')
    expect(owner().style.aspectRatio).toBe('320 / 240')
  })

  it('loads eager images without intersection', () => {
    const { owner, img } = mount({ aspectRatio: 2, loading: 'eager' })
    expect(observed(owner())).toBe(false)
    resize(owner(), 400, 200)
    expect(img().getAttribute('src')).toContain('w=')
  })

  it('observes against the provider root and margin', () => {
    const panel = document.createElement('div')
    mount({ aspectRatio: 2 }, { root: panel, rootMargin: '100px', dwellTime: 0 })
    expect(MockIntersectionObserver.instances.at(-1)!.options).toMatchObject({ root: panel, rootMargin: '100px' })
    mount({ src: '/b.jpg', aspectRatio: 2, rootMargin: '20px' }, { root: panel })
    expect(MockIntersectionObserver.instances.at(-1)!.options).toMatchObject({ root: panel, rootMargin: '20px' })
  })

  it('passes the crop token and revision to the loader', () => {
    const { owner, img } = mount({ aspectRatio: 1, token: '1.k1.abc', version: 'r7' })
    intersect(owner())
    resize(owner(), 128, 128)
    expect(img().getAttribute('src')).toBe('/_img/a.jpg?ar=1&fmt=webp&q=75&token=1.k1.abc&v=r7&w=256')
  })

  it('detects the format with the provider’s detector only once a measured image activates', async () => {
    const { owner, img } = mount({ aspectRatio: 1 }, { loader: createLoader(), detectFormat: detectAvif })
    await advance(1000)
    expect(img().getAttribute('src')).toBe(INERT)
    intersect(owner())
    await advance()
    resize(owner(), 128, 128)
    expect(img().getAttribute('src')).toContain('fmt=avif')
  })

  it('loads SVG, GIF and external sources as is', () => {
    for (const src of ['/logo.svg', '/wave.gif', 'https://images.example.org/fern.jpg?x=1#top']) {
      const { owner, img, unmount } = mount({ src, width: 120, height: 40 })
      intersect(owner())
      expect(img().getAttribute('src'), src).toBe(src)
      expect(img().hasAttribute('srcset'), src).toBe(false)
      unmount()
    }
  })

  it('renders data: and blob: sources as is, without asking the loader', () => {
    const sources = ['data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', 'data:image/png;base64,iVBORw0KGgo=', 'blob:https://example.com/6f1c2a']
    for (const src of sources) {
      for (const unoptimized of [false, true]) {
        const label = `${src} unoptimized=${unoptimized}`
        const { owner, img, unmount } = mount({ src, width: 120, height: 40, unoptimized })
        intersect(owner())
        expect(img().getAttribute('src'), label).toBe(src)
        unmount()
      }
    }
  })

  it('never calls a loader for a direct external URL', () => {
    const url = vi.fn(({ src, width }: { src: string; width: number }) => {
      if (/^https?:/.test(src)) throw new RangeError(`foreign host: ${src}`)
      return `/cdn${src}?w=${width}`
    })
    const src = 'https://images.example.org/fern.jpg'
    const { owner, img } = mount({ src, width: 120, height: 40 }, { loader: url })
    intersect(owner())
    expect(img().getAttribute('src')).toBe(src)
    expect(url).not.toHaveBeenCalled()
  })

  it('installs loader candidates for a measured image on a provider domain', () => {
    const { owner, img } = mount({ src: 'https://cdn.example.com/a.jpg', width: 320, height: 240 }, { domains: ['cdn.example.com'] })
    intersect(owner())
    resize(owner(), 320, 240)
    // Not the original: the loader's URL for the measured slot.
    expect(img().getAttribute('src')).toMatch(/^\/_img\/.*w=640/)
    const sized = mount({ src: 'https://cdn.example.com/b.jpg', width: 320, height: 240, srcWidth: 2400, srcHeight: 1600 }, { domains: ['cdn.example.com'] })
    intersect(sized.owner())
    resize(sized.owner(), 320, 240)
    expect(sized.img().getAttribute('sizes')).toBe('320px')
    expect(sized.img().getAttribute('srcset')).toContain('w=640')
  })

  it('caps prepared candidates at 2× a known width, also with sizes', () => {
    const bare = mount({ width: 320, height: 240, sizes: '320px', loading: 'eager' })
    expect(bare.img().getAttribute('src')).toContain('w=640')
    const { img } = mount({ src: '/b.jpg', width: 320, height: 240, sizes: '320px', loading: 'eager', srcWidth: 2400, srcHeight: 1600 })
    const srcset = img().getAttribute('srcset')!
    // 1× and 2× of the slot on the ladder, not the full ladder up to 2400.
    expect(srcset.split(', ').map((candidate) => candidate.split(' ')[1])).toEqual(classicCandidates({ width: 320, ladder: webp.widths, srcWidth: 2400 }).map((w) => `${w}w`))
    expect(img().getAttribute('sizes')).toBe('320px')
  })

  it('activates the deferred sources of a picture together with the img', () => {
    const { owner, img } = mount({
      aspectRatio: 4 / 3,
      sizes: '100vw',
      srcWidth: 2400,
      srcHeight: 1600,
      sources: [{ media: '(min-width: 800px)', src: '/b.jpg', aspectRatio: 2, sizes: '50vw', srcWidth: 2400, srcHeight: 1600 }],
    })
    const source = owner().querySelector('source')!
    expect(img().parentElement!.tagName).toBe('PICTURE')
    expect(source.hasAttribute('srcset')).toBe(false)
    intersect(owner())
    expect(source.getAttribute('media')).toBe('(min-width: 800px)')
    expect(source.getAttribute('sizes')).toBe('50vw')
    expect(source.getAttribute('srcset')).toBe(source.getAttribute('data-le-srcset'))
    expect(img().getAttribute('srcset')).toContain('/_img/a.jpg?ar=1.333&')
  })

  it('crops a fill image in the browser when the source size is known, on the server when asked', () => {
    const browser = mount({ fill: true, srcWidth: 2400, srcHeight: 1600 })
    intersect(browser.owner())
    resize(browser.owner(), 400, 400)
    expect(browser.img().getAttribute('srcset')).not.toContain('ar=')
    browser.unmount()
    const server = mount({ src: '/b.jpg', fill: true, crop: 'server', srcWidth: 2400, srcHeight: 1600 })
    intersect(server.owner())
    resize(server.owner(), 400, 400)
    expect(server.img().getAttribute('srcset')).toContain('ar=1&')
  })
})

describe('native images', () => {
  for (const props of [{ priority: true }, { loading: 'native' as const }]) {
    it(`calls onLoad from the React handler with currentTarget, once per source (${JSON.stringify(props)})`, () => {
      const targets: (EventTarget | null)[] = []
      const { img } = mount({ width: 320, height: 240, ...props, onLoad: (event) => targets.push(event.currentTarget) })
      load(img())
      expect(targets).toEqual([img()])
      load(img())
      expect(targets).toHaveLength(1)
    })
  }

  it('calls onLoad again for a new revision, and does not paint the placeholder back', () => {
    const onLoad = vi.fn()
    const { img, rerender } = mount({ width: 320, height: 240, loading: 'native', version: 'r1', onLoad })
    load(img())
    expect(img().style.backgroundColor).toBe('')
    rerender({ placeholder: '#00ff00' })
    expect(img().style.backgroundColor).toBe('')
    // The browser starts loading the new URL: the img is no longer complete.
    Object.assign(img(), { complete: false })
    rerender({ version: 'r2', placeholder: '#00ff00' })
    expect(img().getAttribute('src')).toContain('v=r2')
    // The displayed r1 image stays until r2 loads, so no placeholder comes back under it.
    expect(img().style.backgroundColor).toBe('')
    load(img())
    expect(img().style.backgroundColor).toBe('')
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  it('keeps the source of a direct image under a new revision, which does not change its URL', () => {
    const onLoad = vi.fn()
    const states: LoadState[] = []
    const { img, rerender } = mount({ width: 320, height: 240, loading: 'native', unoptimized: true, version: 'r1', onLoad, onStateChange: (state) => states.push(state) })
    load(img())
    rerender({ version: 'r2' })
    // A re-attach for another reason adopts the same displayed source and reports nothing.
    rerender({ version: 'r2', rootMargin: '50px' })
    expect(img().getAttribute('src')).toBe('/a.jpg')
    expect(states).toEqual(['loading', 'loaded'])
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('reports the state of a new revision once, also when it attaches again before or after its load', () => {
    for (const settle of [undefined, fail]) {
      const states: LoadState[] = []
      const { img, rerender, unmount } = mount({ width: 320, height: 240, loading: 'native', version: 'r1', onStateChange: (state) => states.push(state) })
      load(img())
      Object.assign(img(), { complete: false })
      rerender({ version: 'r2' })
      settle?.(img())
      // A re-attach of the same source, loading or failed, repeats no state.
      rerender({ version: 'r2', rootMargin: '50px' })
      expect(states).toEqual(['loading', 'loaded', 'loading', ...(settle ? ['error'] : [])])
      unmount()
    }
  })

  it('reports a failed new revision as an error and leaves its URL in place', () => {
    const onLoad = vi.fn()
    const states: LoadState[] = []
    const { img, rerender } = mount({ width: 320, height: 240, loading: 'native', version: 'r1', onLoad, onStateChange: (state) => states.push(state) })
    load(img())
    // The browser starts loading the new URL: the img is no longer complete.
    Object.assign(img(), { complete: false })
    rerender({ version: 'r2' })
    expect(img().getAttribute('data-state')).toBe('loading')
    fail(img())
    expect(states).toEqual(['loading', 'loaded', 'loading', 'error'])
    expect(img().getAttribute('data-state')).toBe('error')
    // The failed URL stays: the DOM matches the props, and no onLoad came for r2.
    expect(img().getAttribute('src')).toContain('v=r2')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('reports a new revision that is complete at once (cached) as loaded, and calls onLoad on its load', () => {
    const onLoad = vi.fn()
    const states: LoadState[] = []
    const { img, rerender } = mount({ width: 320, height: 240, loading: 'native', version: 'r1', onLoad, onStateChange: (state) => states.push(state) })
    load(img())
    // Still complete when the image attaches again: the controller adopts the new source.
    rerender({ version: 'r2' })
    expect(states).toEqual(['loading', 'loaded', 'loaded'])
    load(img())
    expect(states).toHaveLength(3)
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  // A new revision of a native image attaches it again, with the hooks of the committed render.
  const picture = { sources: [{ media: '(min-width: 800px)', src: '/b.jpg' }] }
  const revisions: [string, Partial<ImageProps>, Partial<ImageProps>][] = [
    ['version', {}, { version: 'r2' }],
    ['token', {}, { token: 't2' }],
    ['version under breakpoint sources', picture, { version: 'r2' }],
  ]
  for (const base of [{ priority: true }, { loading: 'native' as const }]) {
    it.each(revisions)(`reports the state after a new %s before the load (${JSON.stringify(base)})`, (_, initial, change) => {
      for (const settle of [load, fail]) {
        const states: LoadState[] = []
        const { img, rerender, unmount } = mount({ width: 320, height: 240, ...base, ...initial, version: 'r1', token: 't1', onStateChange: (state) => states.push(state) })
        rerender(change)
        settle(img())
        expect(states).toContain(settle === load ? 'loaded' : 'error')
        unmount()
      }
    })
  }
})

describe('lifecycle', () => {
  it('attaches once under Strict Mode and loads normally', async () => {
    const onLoad = vi.fn()
    const states: LoadState[] = []
    const { container } = render(
      <StrictMode>{tree({ width: 320, height: 240, onLoad, onStateChange: (state) => states.push(state) })}</StrictMode>,
    )
    const img = container.querySelector('img')!
    const box = img.parentElement!
    expect(claimed(img)).toBe(true)
    expect(MockIntersectionObserver.instances.filter((o) => o.elements.has(box))).toHaveLength(1)
    intersect(box)
    resize(box, 320, 240)
    load(img)
    await advance(400)
    expect(box.dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(states.filter((state) => state === 'loaded')).toHaveLength(1)
  })

  it('starts over with the placeholder when src changes', async () => {
    const states: LoadState[] = []
    const { owner, img, rerender } = mount({ width: 320, height: 240, onStateChange: (state) => states.push(state) })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance(400)
    const before = img()
    rerender({ src: '/b.jpg' })
    expect(img()).not.toBe(before)
    expect(claimed(before)).toBe(false)
    expect(img().getAttribute('src')).toBe(INERT)
    expect(owner().dataset.state).toBe('idle')
    expect(owner().style.backgroundColor).not.toBe('')
    intersect(owner())
    resize(owner(), 320, 240)
    expect(img().getAttribute('src')).toContain('/_img/b.jpg?')
    expect(states).toEqual(['idle', 'loading', 'loaded', 'idle', 'loading'])
  })

  it('keeps the displayed image when other props change', async () => {
    const onLoad = vi.fn()
    const { owner, img, rerender } = mount({ width: 320, height: 240, quality: 75, onLoad }, { loader: createLoader({ formats: ['webp'], qualities: [50, 75] }) })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance(400)
    const shown = img().getAttribute('src')
    rerender({ quality: 50 })
    expect(img().getAttribute('src')).toBe(shown)
    expect(owner().dataset.state).toBe('loaded')
    expect(img().style.opacity).toBe('')
    intersect(owner())
    resize(owner(), 320, 240)
    expect(img().getAttribute('src')).toContain('q=50')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('calls onLoad once when a re-attach adopts an image that loaded mid-decode', async () => {
    const targets: (EventTarget | null)[] = []
    const onLoad = vi.fn((event: SyntheticEvent<HTMLImageElement>) => targets.push(event.currentTarget))
    decoding.behavior = 'hang'
    const { img, rerender } = mount({ width: 320, height: 240, sizes: '320px', loading: 'eager', fadeDuration: 300, onLoad })
    load(img())
    // Loaded, still decoding: a new signature re-attaches and adopts the complete image.
    rerender({ fadeDuration: 301 })
    await advance(1000)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad.mock.calls[0]![0].type).toBe('load')
    expect(targets).toEqual([img()])
    load(img())
    await advance(1000)
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('resets currentTarget when an adopted onLoad throws', async () => {
    let seen: SyntheticEvent<HTMLImageElement> | undefined
    const onLoad = vi.fn((event: SyntheticEvent<HTMLImageElement>) => {
      seen = event
      throw new Error('onLoad')
    })
    decoding.behavior = 'hang'
    const { img, rerender } = mount({ width: 320, height: 240, sizes: '320px', loading: 'eager', fadeDuration: 300, onLoad })
    load(img())
    rerender({ fadeDuration: 301 })
    await advance(1000).catch(() => {})
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(seen!.currentTarget).toBeNull()
  })

  it('does not replay onLoad when only sizes changes', async () => {
    const onLoad = vi.fn()
    const { img, rerender } = mount({ aspectRatio: 1.5, sizes: '320px', srcWidth: 2400, srcHeight: 1600, loading: 'eager', fadeDuration: 300, onLoad })
    load(img())
    await advance(400)
    expect(onLoad).toHaveBeenCalledTimes(1)
    // The same URLs under a new slot: the controller adopts them, no load event follows.
    rerender({ sizes: '400px' })
    await advance(400)
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('keeps the placeholder until the fade ends through a rerender', async () => {
    const { owner, img, rerender } = mount({ width: 320, height: 240, loading: 'eager', fadeDuration: 300, placeholder: '#00ff00' })
    resize(owner(), 320, 240)
    load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
    rerender({ alt: 'Fern, mid-fade' })
    expect(owner().style.backgroundColor).toBe('rgb(0, 255, 0)')
    await advance(300)
    expect(owner().style.backgroundColor).toBe('')
    rerender({ placeholder: '#0000ff' })
    expect(owner().style.backgroundColor).toBe('')
  })

  it('starts a revision over that was left before it displayed', async () => {
    const onLoad = vi.fn()
    const props = { aspectRatio: 1.5, sizes: '320px', srcWidth: 2400, srcHeight: 1600, loading: 'eager' as const, fadeDuration: 0, onLoad }
    const { owner, img, rerender } = mount({ ...props, version: 'r1', placeholder: '#ff0000' })
    load(img())
    await advance(100)
    expect(onLoad).toHaveBeenCalledTimes(1)
    // r2 with its own placeholder, left again before it loads.
    rerender({ version: 'r2', placeholder: '#00ff00' })
    expect(owner().style.backgroundColor).toBe('rgb(0, 255, 0)')
    rerender({ version: 'r1', placeholder: '#ff0000' })
    expect(owner().style.backgroundColor).toBe('rgb(255, 0, 0)')
    load(img())
    await advance(100)
    expect(owner().dataset.state).toBe('loaded')
    expect(owner().style.backgroundColor).toBe('')
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  it('keeps the author’s background over the placeholder when it attaches', () => {
    const boxed = mount({ aspectRatio: 1.5, wrapperStyle: { backgroundColor: '#123456' } })
    expect(boxed.owner().style.backgroundColor).toBe('rgb(18, 52, 86)')
    const bare = mount({ aspectRatio: 1.5, fadeDuration: 0, style: { backgroundColor: '#123456' } })
    expect(bare.owner()).toBe(bare.img())
    expect(bare.img().style.backgroundColor).toBe('rgb(18, 52, 86)')
  })

  it('positions the no-JS fallback of a measured browser crop at the focal point', () => {
    const props = { fill: true, srcWidth: 2400, srcHeight: 1600, focalPoint: { x: 90, y: 50 } }
    const markup = renderToString(tree({ ...props, noScript: true }))
    expect(markup).toContain('container-type:size')
    expect(markup.match(/<noscript[^>]*>(.*?)<\/noscript>/)?.[1]).toContain('object-position:clamp(')
  })

  it('stacks the noScript fallback with the inert img in one grid cell', () => {
    const markup = renderToString(tree({ width: 320, fadeDuration: 0, noScript: true }))
    expect(markup).toContain('display:grid')
    // The inert img, the noscript element and the fallback img.
    expect(markup.match(/grid-area:1\/1/g)).toHaveLength(3)
    expect(markup).not.toContain('position:absolute')
  })

  it('attaches to the new img when noScript is turned on after load', async () => {
    const { container, img, rerender } = mount({ aspectRatio: 1.5, sizes: '320px', loading: 'eager', fadeDuration: 0 })
    load(img())
    await advance(100)
    expect(img().dataset.state).toBe('loaded')
    const before = img()
    rerender({ noScript: true })
    expect(container.querySelector('span')).not.toBeNull()
    expect(img()).not.toBe(before)
    expect(claimed(img())).toBe(true)
    expect(img().getAttribute('src')).not.toBe(INERT)
    load(img())
    await advance(100)
    expect(img().closest<HTMLElement>('[data-le]')!.dataset.state).toBe('loaded')
  })

  it('does not call onLoad when a re-attach adopts an image whose load it never saw', async () => {
    const onLoad = vi.fn()
    const { img, rerender } = mount({ width: 320, height: 240, sizes: '320px', loading: 'eager', fadeDuration: 300, onLoad })
    // The inert placeholder's load is stored, but it is not the target's.
    load(img(), INERT)
    complete(img(), img().getAttribute('src')!)
    rerender({ fadeDuration: 301 })
    await advance(1000)
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('keeps the attachment through re-renders with a fresh inline loader', async () => {
    const observe = vi.spyOn(MockIntersectionObserver.prototype, 'observe')
    const inline = () => ({ src, width }: { src: string; width: number }) => `/cdn${src}?w=${width}`
    const { owner, img, rerender } = mount({ width: 320, height: 240, loader: inline() }, { dwellTime: 500 })
    intersect(owner())
    for (let i = 0; i < 4; i++) {
      await advance(200)
      rerender({ loader: inline() })
    }
    expect(observe).toHaveBeenCalledTimes(1)
    // The dwell ran once, uninterrupted, so the image activated.
    resize(owner(), 320, 240)
    expect(img().getAttribute('src')).toBe('/cdn/a.jpg?w=640')
  })

  it('re-attaches when the loader’s URL scheme changes with the same capabilities', async () => {
    const scheme = (base: string) => ({ src, width }: { src: string; width: number }) => `${base}${src}?w=${width}`
    const { owner, img, rerender } = mount({ width: 320, height: 240, loader: scheme('/old') })
    intersect(owner())
    // A function loader has the default formats: detection settles first.
    await advance()
    resize(owner(), 320, 240)
    load(img())
    await advance(400)
    expect(img().getAttribute('src')).toBe('/old/a.jpg?w=640')
    rerender({ loader: scheme('/new') })
    intersect(owner())
    await advance()
    resize(owner(), 320, 240)
    expect(img().getAttribute('src')).toBe('/new/a.jpg?w=640')
  })

  it('starts a prepared image over on a quality change, but upgrades a measured one in place', async () => {
    const provider = { loader: createLoader({ formats: ['webp'], qualities: [50, 75] }) }
    // Prepared: the URL list is the source, so new URLs are a new source with its placeholder.
    const prepared = mount({ aspectRatio: 1.5, sizes: '320px', srcWidth: 2400, srcHeight: 1600 }, provider)
    intersect(prepared.owner())
    const before = prepared.img().getAttribute('srcset')
    load(prepared.img())
    await advance(400)
    expect(prepared.owner().dataset.state).toBe('loaded')
    prepared.rerender({ quality: 50 })
    expect(prepared.owner().dataset.state).toBe('idle')
    expect(prepared.img().getAttribute('src')).toBe(INERT)
    expect(prepared.img().hasAttribute('srcset')).toBe(false)
    intersect(prepared.owner())
    expect(prepared.img().getAttribute('srcset')).not.toBe(before)
    expect(prepared.img().style.opacity).toBe('0')
    prepared.unmount()

    // Measured: the logical source is src, so the displayed image stays and is replaced in place.
    const measured = mount({ width: 320, height: 240 }, provider)
    intersect(measured.owner())
    resize(measured.owner(), 320, 240)
    const url = measured.img().getAttribute('src')
    load(measured.img())
    await advance(400)
    measured.rerender({ quality: 50 })
    expect(measured.owner().dataset.state).toBe('loaded')
    expect(measured.img().getAttribute('src')).toBe(url)
    intersect(measured.owner())
    resize(measured.owner(), 320, 240)
    expect(measured.img().getAttribute('src')).not.toBe(url)
    expect(measured.img().style.opacity).toBe('')
    expect(measured.owner().dataset.state).toBe('loaded')
  })

  it('calls onLoad again for a new revision of the same src', async () => {
    const onLoad = vi.fn()
    const { owner, img, rerender } = mount({ width: 320, height: 240, version: 'r1', onLoad })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance(400)
    expect(onLoad).toHaveBeenCalledTimes(1)
    rerender({ version: 'r2' })
    expect(owner().dataset.state).toBe('idle')
    intersect(owner())
    resize(owner(), 320, 240)
    expect(img().getAttribute('src')).toContain('v=r2')
    load(img())
    await advance(400)
    expect(owner().dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  it('calls onLoad again for new prepared URLs, not for an upgrade of a measured image', async () => {
    const provider = { loader: createLoader({ formats: ['webp'], qualities: [50, 75] }) }
    const onLoad = vi.fn()
    const prepared = mount({ aspectRatio: 1.5, sizes: '320px', srcWidth: 2400, srcHeight: 1600, onLoad }, provider)
    intersect(prepared.owner())
    load(prepared.img())
    await advance(400)
    prepared.rerender({ quality: 50 })
    intersect(prepared.owner())
    load(prepared.img())
    await advance(400)
    expect(prepared.owner().dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(2)
    prepared.unmount()

    onLoad.mockClear()
    const measured = mount({ width: 320, height: 240, onLoad }, provider)
    intersect(measured.owner())
    resize(measured.owner(), 320, 240)
    load(measured.img())
    await advance(400)
    const url = measured.img().getAttribute('src')
    // A larger slot and a new quality both upgrade the displayed image in place.
    resize(measured.owner(), 640, 480)
    await advance(400)
    expect(measured.img().getAttribute('src')).not.toBe(url)
    load(measured.img())
    await advance(400)
    measured.rerender({ quality: 50 })
    intersect(measured.owner())
    resize(measured.owner(), 640, 480)
    expect(measured.img().getAttribute('src')).toContain('q=50')
    load(measured.img())
    await advance(400)
    expect(measured.owner().dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('re-attaches for new picture sources with the same src', () => {
    const source = (src: string) => [{ media: '(min-width: 800px)', src, sizes: '50vw', srcWidth: 2400, srcHeight: 1600 }]
    const { owner, rerender } = mount({ aspectRatio: 1.5, sizes: '100vw', srcWidth: 2400, srcHeight: 1600, sources: source('/b.jpg') })
    intersect(owner())
    expect(owner().querySelector('source')!.getAttribute('srcset')).toContain('/_img/b.jpg?')
    rerender({ sources: source('/c.jpg') })
    intersect(owner())
    const next = owner().querySelector('source')!
    expect(next.getAttribute('srcset')).toContain('/_img/c.jpg?')
    expect(next.getAttribute('srcset')).toBe(next.getAttribute('data-le-srcset'))
  })

  it('keeps the fade of an eager prepared image under Strict Mode', async () => {
    const { container } = render(<StrictMode>{tree({ aspectRatio: 1.5, sizes: '320px', loading: 'eager', srcWidth: 2400, srcHeight: 1600 })}</StrictMode>)
    const img = container.querySelector('img')!
    expect(img.getAttribute('srcset')).toContain('/_img/a.jpg?')
    expect(img.style.opacity).toBe('0')
    load(img)
    await advance()
    expect(img.style).toMatchObject({ opacity: '1', transition: 'opacity 400ms ease-out' })
    await advance(400)
    expect(img.style.opacity).toBe('')
  })

  it('releases observers and the claim on unmount', () => {
    const { owner, img, unmount } = mount({ width: 320, height: 240 })
    const box = owner()
    const element = img()
    unmount()
    expect(observed(box)).toBe(false)
    expect(claimed(element)).toBe(false)
  })
})

describe('keepImage', () => {
  /** A displayed `/a.jpg` image whose src then changes to `/b.jpg`. */
  async function swapped(props: Partial<ImageProps>) {
    const onLoad = vi.fn()
    const states: LoadState[] = []
    const view = mount({ keepImage: true, placeholder: '#123456', onLoad, onStateChange: (state) => states.push(state), ...props })
    intersect(view.owner())
    resize(view.owner(), 320, 240)
    load(view.img())
    await advance(400)
    const before = view.img()
    const old = before.currentSrc
    view.rerender({ src: '/b.jpg', placeholder: '#654321' })
    return { ...view, onLoad, states, before, old }
  }

  for (const [kind, props] of [
    ['measured', { width: 320, height: 240 }],
    ['prepared', { width: 320, height: 240, sizes: '320px' }],
  ] as const)
    it(`keeps a ${kind} image on display under a new src, without the new placeholder, and calls onLoad once for it`, async () => {
      const { img, owner, onLoad, states, before, old } = await swapped(props)
      expect(img()).toBe(before)
      expect(owner().style.backgroundColor).toBe('')
      expect(owner().style.backgroundImage).toBe(`url("${old}")`)
      // Until the new source activates, the img still shows the old one.
      expect(img().currentSrc).toBe(old)
      intersect(owner())
      resize(owner(), 320, 240)
      expect(JSON.stringify([img().getAttribute('src'), img().getAttribute('srcset')])).toContain('/_img/b.jpg?')
      expect(img().style.opacity).toBe('0')
      expect(owner().style.backgroundColor).toBe('')
      expect(onLoad).toHaveBeenCalledTimes(1)
      load(img())
      await advance(0)
      expect(onLoad).toHaveBeenCalledTimes(2)
      await advance(400)
      expect(owner().style.backgroundImage).toBe('')
      expect(states).toEqual(['idle', 'loading', 'loaded', 'idle', 'loading', 'loaded'])
    })

  it('shows the error state when the new source fails, without the old image', async () => {
    const { img, owner, onLoad } = await swapped({ width: 320, height: 240 })
    intersect(owner())
    resize(owner(), 320, 240)
    fail(img())
    expect(owner().dataset.state).toBe('error')
    expect(owner().style.backgroundImage).toBe('')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('paints the new placeholder when the image before it failed', async () => {
    const { img, owner, rerender } = mount({ width: 320, height: 240, keepImage: true, placeholder: '#123456' })
    intersect(owner())
    resize(owner(), 320, 240)
    fail(img())
    rerender({ src: '/b.jpg', placeholder: '#654321' })
    expect(img().getAttribute('src')).toBe(INERT)
    expect(owner().style.backgroundColor).toBe('rgb(101, 67, 33)')
  })

  it('starts over with the placeholder for a new src without keepImage', async () => {
    const { img, owner, before } = await swapped({ width: 320, height: 240, keepImage: false })
    expect(img()).not.toBe(before)
    expect(owner().style.backgroundColor).toBe('rgb(101, 67, 33)')
  })
})

describe('a callback that changes src synchronously', () => {
  // A callback of the image for /a.jpg renders /b.jpg at once, with flushSync. B starts from its placeholder,
  // and nothing of A's attachment writes to the box afterwards.
  type Hooks = (fire: () => void) => Partial<ImageProps>
  const rows: [string, Hooks][] = [
    ['onStateChange loading', (fire) => ({ onStateChange: (state) => state === 'loading' && fire() })],
    ['onStateChange loaded', (fire) => ({ onStateChange: (state) => state === 'loaded' && fire() })],
    ['onLoad', (fire) => ({ onLoad: fire })],
    ['reveal', (fire) => ({ reveal: (edge) => (fire(), focusReveal(edge)) })],
  ]
  it.each(rows)('%s', async (_, hooks) => {
    let fired = 0
    function Swap() {
      const [src, set] = useState('/a.jpg')
      const fire = () => src === '/a.jpg' && (fired++, flushSync(() => set('/b.jpg')))
      return <Image src={src} alt="Fern" width={320} height={240} placeholder="#00ff00" {...hooks(fire)} />
    }
    const { container } = render(
      <LazyEaseProvider loader={webp}>
        <Swap />
      </LazyEaseProvider>,
    )
    const img = () => container.querySelector('img')!
    const owner = () => img().closest<HTMLElement>('[data-le]')!
    const a = img()
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance(1000)
    expect(fired).toBe(1)
    expect(img()).not.toBe(a)
    expect(claimed(a)).toBe(false)
    expect(img().getAttribute('src')).toBe(INERT)
    expect(owner().dataset.state).toBe('idle')
    expect(owner().style.backgroundColor).toBe('rgb(0, 255, 0)')
    intersect(owner())
    resize(owner(), 320, 240)
    expect(img().getAttribute('src')).toContain('/_img/b.jpg?')
    expect(img().style.opacity).toBe('0')
    expect(owner().dataset.state).toBe('loading')
    await advance(1000)
    expect(owner().dataset.state).toBe('loading')
    expect(owner().style.backgroundColor).toBe('rgb(0, 255, 0)')
  })
})

describe('an update React has not committed', () => {
  // A transition whose sibling suspends keeps the old props on screen, so the image keeps
  // calling the committed hooks and painting the committed placeholder.
  const never = new Promise<never>(() => {})
  function Gate({ hold }: { hold: boolean }) {
    if (hold) use(never)
    return null
  }
  function harness(initial: Partial<ImageProps>) {
    type Held = Partial<ImageProps> & { hold: boolean }
    let update!: (props: Held) => void
    let tweak!: (className: string) => void
    function App() {
      const [props, setProps] = useState<Held>({ ...initial, hold: false })
      const [className, setClassName] = useState('a')
      update = setProps
      tweak = setClassName
      const { hold, ...rest } = props
      return (
        <LazyEaseProvider loader={webp}>
          <Suspense fallback={null}>
            <Image src="/a.jpg" alt="Fern" width={320} height={240} fadeDuration={300} className={className} {...rest} />
            <Gate hold={hold} />
          </Suspense>
        </LazyEaseProvider>
      )
    }
    const { container } = render(<App />)
    const img = () => container.querySelector('img')!
    const owner = () => img().closest<HTMLElement>('[data-le]')!
    return {
      img,
      owner,
      // A transition held by the suspending sibling.
      hold: (props: Partial<ImageProps>) => act(async () => startTransition(() => update({ ...props, hold: true }))),
      // An urgent update, rendered on the committed props.
      tweak: (className: string) => act(async () => tweak(className)),
    }
  }

  type Hooks = (fn: () => void) => Partial<ImageProps>
  const rows: [string, Hooks][] = [
    ['reveal', (fn) => ({ reveal: (edge) => (fn(), focusReveal(edge)) })],
    ['onLoad', (fn) => ({ onLoad: fn })],
    ['onStateChange', (fn) => ({ onStateChange: (state) => state === 'loaded' && fn() })],
    // Render probes the loader with its narrowest width; the controller asks for the box's.
    ['loader', (fn) => ({ loader: ({ src, width }) => (width > 100 && fn(), `/x${src}?w=${width}`) })],
  ]
  it.each(rows)('%s', async (_, hooks) => {
    const animate = vi.fn(() => ({ cancel() {} }))
    Object.defineProperty(HTMLImageElement.prototype, 'animate', { configurable: true, value: animate })
    try {
      const a = vi.fn()
      const b = vi.fn()
      const { img, owner, hold } = harness(hooks(a))
      intersect(owner())
      await hold({ className: 'b', ...hooks(b) })
      expect(img().className).toBe('a')
      a.mockClear()
      resize(owner(), 320, 240)
      load(img())
      await advance(400)
      expect(img().className).toBe('a')
      expect(a).toHaveBeenCalled()
      expect(b).not.toHaveBeenCalled()
    } finally {
      delete (HTMLImageElement.prototype as { animate?: unknown }).animate
    }
  })

  it('placeholder of a displayed image', async () => {
    const { img, owner, hold, tweak } = harness({ placeholder: '#00ff00', version: 'r1' })
    intersect(owner())
    resize(owner(), 320, 240)
    load(img())
    await advance(400)
    expect(owner().style.backgroundColor).toBe('')
    // A new source under the same src, with its own placeholder.
    await hold({ placeholder: '#ff0000', version: 'r2' })
    expect(owner().style.backgroundColor).toBe('')
    await tweak('c')
    expect(img().className).toBe('c')
    expect(owner().style.backgroundColor).toBe('')
  })
})

describe('a new source committed before the old one is destroyed', () => {
  // Between the commit, which publishes the new render's hooks, and the passive destroy of
  // the old attachment, the old source can finish loading. Its events reach no new hook.
  it('reaches no hook of the new render', async () => {
    vi.useRealTimers()
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previous = env.IS_REACT_ACT_ENVIRONMENT
    env.IS_REACT_ACT_ENVIRONMENT = false
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const tick = () => new Promise((resolve) => setTimeout(resolve, 50))
    try {
      const a = vi.fn()
      const b = vi.fn()
      const statesB: LoadState[] = []
      // A sibling whose layout effect runs in the same commit, before the passive effects.
      function Kick({ on }: { on: boolean }) {
        useLayoutEffect(() => {
          if (on) core.load(container.querySelector('img')!)
        })
        return null
      }
      const view = (version: string, onLoad: () => void, on: boolean, onStateChange?: (state: LoadState) => void) => (
        <LazyEaseProvider loader={webp}>
          <Image src="/a.jpg" version={version} alt="Fern" width={320} height={240} fadeDuration={0} onLoad={onLoad} onStateChange={onStateChange} />
          <Kick on={on} />
        </LazyEaseProvider>
      )
      root.render(view('r1', a, false))
      await tick()
      const img = container.querySelector('img')!
      const owner = img.closest<HTMLElement>('[data-le]')!
      core.intersect(owner)
      core.resize(owner, 320, 240)
      await tick()
      root.render(view('r2', b, true, (state) => statesB.push(state)))
      await tick()
      expect(b).not.toHaveBeenCalled()
      expect(statesB).not.toContain('loaded')
      // The new source loads and fires its own first onLoad.
      core.intersect(owner)
      core.resize(owner, 320, 240)
      await tick()
      expect(img.getAttribute('src')).toContain('v=r2')
      core.load(img)
      await tick()
      expect(b).toHaveBeenCalledTimes(1)
      expect(statesB.filter((state) => state === 'loaded')).toHaveLength(1)
    } finally {
      root.unmount()
      container.remove()
      env.IS_REACT_ACT_ENVIRONMENT = previous
    }
  })
})

describe('an old attachment in the commit that replaces it', () => {
  // A sibling's layout effect runs in the same commit as the new render, before passive
  // effects: the old source finishing there reaches neither the new hooks nor its own.
  async function inRoot(run: (root: ReturnType<typeof createRoot>, container: HTMLElement, tick: () => Promise<unknown>) => Promise<void>) {
    vi.useRealTimers()
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previous = env.IS_REACT_ACT_ENVIRONMENT
    env.IS_REACT_ACT_ENVIRONMENT = false
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await run(root, container, () => new Promise((resolve) => setTimeout(resolve, 50)))
    } finally {
      root.unmount()
      container.remove()
      env.IS_REACT_ACT_ENVIRONMENT = previous
    }
  }
  function Kick({ run }: { run?: () => void }) {
    useLayoutEffect(() => run?.())
    return null
  }

  it('runs no reveal of a new version for the old one, whose decode ends in a transition', () =>
    inRoot(async (root, container, tick) => {
      let finish!: () => void
      vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      const revealed: string[] = []
      const reveal = (edge: number) => (revealed.push(container.querySelector('img')!.currentSrc), focusReveal(edge))
      const view = (version: string, run?: () => void) => (
        <LazyEaseProvider loader={webp}>
          <Image src="/a.jpg" version={version} alt="Fern" width={320} height={240} fadeDuration={300} reveal={version === 'r2' ? reveal : focusReveal} />
          <Kick run={run} />
        </LazyEaseProvider>
      )
      root.render(view('r1'))
      await tick()
      const img = container.querySelector('img')!
      const owner = img.closest<HTMLElement>('[data-le]')!
      core.intersect(owner)
      core.resize(owner, 320, 240)
      await tick()
      expect(img.getAttribute('src')).toContain('v=r1')
      core.load(img)
      startTransition(() => root.render(view('r2', () => finish())))
      await tick()
      expect(revealed).toEqual([])
      expect(img.style.opacity).not.toBe('1')
    }))

  it('calls no onLoad of a removed source, whose load ends as the new one commits', () =>
    inRoot(async (root, container, tick) => {
      const connected: boolean[] = []
      const onLoad = (event: SyntheticEvent<HTMLImageElement>) => connected.push(event.currentTarget.isConnected)
      const view = (src: string, run?: () => void) => (
        <LazyEaseProvider loader={webp}>
          <Image src={src} alt="Fern" width={320} height={240} fadeDuration={0} onLoad={onLoad} />
          <Kick run={run} />
        </LazyEaseProvider>
      )
      root.render(view('/a.jpg'))
      await tick()
      const old = container.querySelector('img')!
      const owner = old.closest<HTMLElement>('[data-le]')!
      core.intersect(owner)
      core.resize(owner, 320, 240)
      await tick()
      let finish!: () => void
      vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      core.load(old)
      startTransition(() => root.render(view('/b.jpg', () => finish())))
      await tick()
      expect(old.isConnected).toBe(false)
      expect(connected).toEqual([])
    }))
})

describe('a Suspense boundary that hides the image', () => {
  // Hiding ends the attachment with the layout effects; showing it again attaches anew.
  it('loads it once it shows again, with one onLoad', async () => {
    let resume!: () => void
    const gate = new Promise<void>((resolve) => (resume = resolve))
    function Gate({ hold }: { hold: boolean }) {
      if (hold) use(gate)
      return null
    }
    let hold!: (value: boolean) => void
    const onLoad = vi.fn()
    const states: LoadState[] = []
    function App() {
      const [held, setHeld] = useState(false)
      hold = setHeld
      return (
        <LazyEaseProvider loader={webp}>
          <Suspense fallback={null}>
            <Image src="/a.jpg" alt="Fern" width={320} height={240} fadeDuration={300} onLoad={onLoad} onStateChange={(state) => states.push(state)} />
            <Gate hold={held} />
          </Suspense>
        </LazyEaseProvider>
      )
    }
    const { container } = render(<App />)
    const img = container.querySelector('img')!
    const owner = img.closest<HTMLElement>('[data-le]')!
    intersect(owner)
    resize(owner, 320, 240)
    expect(img.getAttribute('src')).toContain('w=640')
    await act(async () => hold(true))
    expect(claimed(img)).toBe(false)
    await act(async () => resume())
    expect(container.querySelector('img')).toBe(img)
    expect(claimed(img)).toBe(true)
    load(img)
    await advance(400)
    expect(img.style.opacity).toBe('')
    expect(owner.style.backgroundColor).toBe('')
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(states.filter((state) => state === 'loaded')).toHaveLength(1)
  })
})

describe('placeholders', () => {
  it('paints a color, a covering data URI or nothing', () => {
    expect(mount({ width: 320, height: 240, placeholder: '#5b6c8f' }).owner().style.backgroundColor).toBe('rgb(91, 108, 143)')
    const data = mount({ width: 320, height: 240, placeholder: 'data:image/png;base64,AAAA' }).owner().style
    expect(data).toMatchObject({ backgroundImage: 'url("data:image/png;base64,AAAA")', backgroundSize: 'cover', backgroundPosition: 'center center' })
    const none = mount({ width: 320, height: 240, placeholder: 'none' }).owner().style
    expect(none.backgroundColor + none.backgroundImage).toBe('')
  })

  it('uses the provider default, also for an invalid placeholder, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mount({ width: 320, height: 240 }, { placeholder: '#00ff00' }).owner().style.backgroundColor).toBe('rgb(0, 255, 0)')
    expect(mount({ src: '/bad.jpg', width: 320, height: 240, placeholder: 'red;x' }).owner().style.backgroundColor).toBe('rgb(229, 231, 235)')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid placeholder for /bad.jpg'))
  })

  it('needs the provider decoder for a ThumbHash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mount({ width: 320, height: 240, placeholder: RED }).owner().style.backgroundColor).toBe('rgb(229, 231, 235)')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('thumbhash decoder'))
  })

  it('shows the ThumbHash color, and its image once the image activates', () => {
    const { owner } = mount({ width: 320, height: 240, placeholder: RED }, { thumbhash: decoder })
    expect(owner().style.backgroundColor).toMatch(/^rgb\(2\d\d, \d, \d\)$/)
    expect(owner().style.backgroundImage).toBe('')
    intersect(owner())
    expect(owner().style.backgroundImage).toContain('data:image/png;base64,')
    expect(owner().style.backgroundPosition).toBe('center center')
  })

  it('paints a transparent ThumbHash image without its color, and removes it after the fade', async () => {
    const rgba = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < 256; i++) if (i % 16 < 8) rgba.set([0, 128, 255, 255], i * 4)
    const half = `thumbhash:${btoa(String.fromCharCode(...thumbhash.rgbaToThumbHash(16, 16, rgba)))}`
    const { owner, img } = mount({ width: 320, height: 240, placeholder: half, fadeDuration: 300 }, { thumbhash: decoder })
    expect(owner().style.backgroundColor).toMatch(/^rgba\(/)
    intersect(owner())
    expect(owner().style.backgroundColor).toBe('')
    expect(owner().style.backgroundImage).toContain('data:image/svg+xml')
    expect(decodeURIComponent(owner().style.backgroundImage)).not.toContain('feFuncA')
    resize(owner(), 320, 240)
    load(img())
    await advance(300)
    expect(owner().style.backgroundImage).toBe('')
  })

  it('fades out a transparent ThumbHash during the fade, also one painted as its image on the server', async () => {
    const animate = vi.fn(() => ({ cancel() {} }))
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    // The box's fade-out: its inline decoded image animated to the inert pixel.
    const fadesOut = () => animate.mock.calls.some((call: unknown[]) => String((call[0] as Keyframe).backgroundImage).includes('data:image/gif'))
    try {
      const rgba = new Uint8Array(16 * 16 * 4)
      for (let i = 0; i < 256; i++) if (i % 16 < 8) rgba.set([0, 128, 255, 255], i * 4)
      const half = `thumbhash:${btoa(String.fromCharCode(...thumbhash.rgbaToThumbHash(16, 16, rgba)))}`
      for (const [placeholder, thumbhashSsr, expected] of [
        [half, undefined, true],
        [half, 'image', true],
        [RED, undefined, false],
        [RED, 'image', false],
      ] as [string, 'image' | undefined, boolean][]) {
        animate.mockClear()
        const { owner, img, unmount } = mount({ width: 320, height: 240, placeholder, fadeDuration: 300 }, { thumbhash: decoder, thumbhashSsr })
        intersect(owner())
        resize(owner(), 320, 240)
        load(img())
        await advance()
        expect(fadesOut()).toBe(expected)
        unmount()
      }
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate
    }
  })

  it('uses the latest reveal function without re-attaching', async () => {
    const animate = vi.fn(() => ({ cancel() {} }))
    Object.defineProperty(HTMLImageElement.prototype, 'animate', { configurable: true, value: animate })
    try {
      const first = vi.fn(() => [{ opacity: 0 }, { opacity: 1 }])
      const second = vi.fn(() => [{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1 }])
      const { owner, img, rerender } = mount({ width: 320, height: 240, fadeDuration: 300, reveal: first })
      const before = img()
      rerender({ reveal: second })
      expect(img()).toBe(before)
      intersect(owner())
      resize(owner(), 320, 240)
      load(img())
      await advance()
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith(320)
      expect(animate).toHaveBeenCalledWith([{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1 }], 300)
    } finally {
      delete (HTMLImageElement.prototype as { animate?: unknown }).animate
    }
  })

  it('reveals with focus from the provider or the prop', async () => {
    const animate = vi.fn(() => ({ cancel() {} }))
    Object.defineProperty(HTMLImageElement.prototype, 'animate', { configurable: true, value: animate })
    try {
      for (const [props, provider] of [[{ reveal: focusReveal }, {}], [{}, { reveal: focusReveal }]] as [Partial<ImageProps>, Provider][]) {
        animate.mockClear()
        const { owner, img, unmount } = mount({ width: 320, height: 240, fadeDuration: 300, ...props }, provider)
        intersect(owner())
        resize(owner(), 320, 240)
        load(img())
        await advance()
        expect(animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ filter: 'blur(25.6px)' })]), 300)
        unmount()
      }
      const { owner, img } = mount({ width: 320, height: 240, fadeDuration: 300 })
      animate.mockClear()
      intersect(owner())
      resize(owner(), 320, 240)
      load(img())
      await advance()
      expect(animate).toHaveBeenCalledWith({ opacity: [0, 1], easing: 'ease-out' }, 300)
    } finally {
      delete (HTMLImageElement.prototype as { animate?: unknown }).animate
    }
  })

  it('does not paint the placeholder back once the image is displayed, but does for a new source', async () => {
    for (const fadeDuration of [undefined, 0]) {
      const { owner, img, rerender, unmount } = mount({ width: 320, height: 240, version: 'r1', fadeDuration })
      intersect(owner())
      resize(owner(), 320, 240)
      load(img())
      await advance(400)
      expect(owner().style.backgroundColor).toBe('')
      rerender({ placeholder: '#00ff00' })
      expect(owner().dataset.state).toBe('loaded')
      expect(owner().style.backgroundColor).toBe('')
      rerender({ placeholder: '#00ff00', version: 'r2' })
      expect(owner().style.backgroundColor).toBe('rgb(0, 255, 0)')
      unmount()
    }
  })

  it('moves an image placeholder with the focal point', () => {
    const style = mount({ width: 320, height: 240, placeholder: 'data:image/png;base64,AAAA', focalPoint: { x: 30, y: 60 } }).owner().style
    expect(style.backgroundPosition).toBe('30% 60%')
  })
})

describe('no-JS fallback', () => {
  const noscript = (props: Partial<ImageProps>) => renderToString(tree(props)).match(/<noscript[^>]*>(.*?)<\/noscript>/)?.[1]

  it('is opt-in', () => {
    expect(noscript({ width: 320, height: 240 })).toBeUndefined()
  })

  it('renders the native candidates of a deferred image with noScript', () => {
    const markup = noscript({ width: 320, height: 240, srcWidth: 2400, srcHeight: 1600, noScript: true })!
    expect(markup).toContain('sizes="320px"')
    expect(markup).toContain('384w')
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('grid-area:1/1')
    expect(noscript({ src: 'https://other.site/a.jpg', width: 320, height: 240, noScript: true })).toContain('src="https://other.site/a.jpg"')
  })

  it('keeps a box for the fallback and stacks it on the placeholder img', () => {
    for (const props of [
      { width: 320, height: 240, fadeDuration: 0 },
      { srcWidth: 2400, srcHeight: 1600, fadeDuration: 0 },
      { width: 320, srcWidth: 2400, srcHeight: 1600 },
      { width: 320, height: 240, sizes: '320px', fadeDuration: 0 },
    ]) {
      const markup = renderToString(tree({ ...props, noScript: true }))
      expect(markup).toMatch(/^<span data-le="" data-le-auto="off" style="display:grid;grid-template-rows:100%;position:relative/)
      expect(noscript({ ...props, noScript: true })).toContain('grid-area:1/1')
    }
  })

  it('is never needed for a native image', () => {
    expect(noscript({ width: 320, height: 240, loading: 'native', noScript: true })).toBeUndefined()
  })
})

describe('the vanilla script', () => {
  it('leaves React images alone when it runs before hydration', async () => {
    const element = tree({ width: 320, height: 240 })
    const container = document.createElement('div')
    container.setAttribute('data-le-auto', '')
    container.innerHTML = renderToString(element)
    document.body.append(container)
    const box = container.querySelector<HTMLElement>('[data-le]')!
    enhance(createLazyEase({ loader: webp }), container)
    expect(box.hasAttribute('data-state')).toBe(false)
    expect(claimed(container.querySelector('img')!)).toBe(false)
    const root = await act(async () => hydrateRoot(container, element))
    expect(box.dataset.state).toBe('idle')
    act(() => root.unmount())
    container.remove()
  })

  it('adopts an image that loaded before hydration', async () => {
    const onLoad = vi.fn()
    const states: LoadState[] = []
    const element = tree({ width: 320, height: 240, priority: true, onLoad, onStateChange: (state) => states.push(state) })
    const container = document.createElement('div')
    container.innerHTML = renderToString(element)
    document.body.append(container)
    const img = container.querySelector('img')!
    complete(img)
    const root = await act(async () => hydrateRoot(container, element))
    expect(img.dataset.state).toBe('loaded')
    expect(states).toEqual(['loaded'])
    // Adoption fabricates no event.
    expect(onLoad).not.toHaveBeenCalled()
    expect(img.style.opacity).toBe('')
    act(() => root.unmount())
    container.remove()
  })
})
