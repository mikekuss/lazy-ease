import { act, render } from '@testing-library/react'
import { StrictMode, createRef, type ReactNode, type SyntheticEvent } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import * as thumbhash from 'thumbhash'
import { describe, expect, it, vi } from 'vitest'
import { candidateSet, classicCandidates, createLazyEase, createLoader, fullLadder, measuredCandidates, snapRatio, type LoadState } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
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

  it('detects the format only once a measured image activates', async () => {
    const { owner, img } = mount({ aspectRatio: 1 }, { loader: createLoader() })
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

  it('moves an image placeholder with the focal point', () => {
    const style = mount({ width: 320, height: 240, placeholder: 'data:image/png;base64,AAAA', focalPoint: { x: 30, y: 60 } }).owner().style
    expect(style.backgroundPosition).toBe('30% 60%')
  })
})

describe('no-JS fallback', () => {
  const noscript = (props: Partial<ImageProps>) => renderToString(tree(props)).match(/<noscript>(.*?)<\/noscript>/)?.[1]

  it('is opt-in', () => {
    expect(noscript({ width: 320, height: 240 })).toBeUndefined()
  })

  it('renders the native candidates of a deferred image with noScript', () => {
    const markup = noscript({ width: 320, height: 240, srcWidth: 2400, srcHeight: 1600, noScript: true })!
    expect(markup).toContain('sizes="320px"')
    expect(markup).toContain('384w')
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('position:absolute')
    expect(noscript({ src: 'https://other.site/a.jpg', width: 320, height: 240, noScript: true })).toContain('src="https://other.site/a.jpg"')
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
