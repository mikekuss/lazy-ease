// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLazyEase, createLoader, whenVisible, type AttachOptions, type ImageRequest, type LazyEaseConfig, type LoadState } from '../src/index.js'
import { resetFormatDetection } from '../src/dom/format.js'
import { observeResize, resetObservers } from '../src/dom/observe.js'
import { fail, fakeImage, flush, installDom, intersect, load, media, MockIntersectionObserver, MockResizeObserver, probe, resize } from './dom-mocks.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const PLACEHOLDER = 'rgb(187, 200, 207)'

beforeEach(() => {
  installDom()
  resetFormatDetection()
  resetObservers()
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A boxed deferred image as a template renders it: inert src, placeholder on the box. */
function boxed(imgAttributes = '') {
  document.body.innerHTML = `<span data-le style="display:block;background-color:${PLACEHOLDER}"><img alt="Fern" src="${INERT}" ${imgAttributes}></span>`
  const box = document.querySelector('span')!
  const img = document.querySelector('img')!
  return { box, img, fake: fakeImage(img) }
}

const webpLoader = createLoader({ formats: ['webp'] })

function setup(config: LazyEaseConfig = {}, imgAttributes = '') {
  const states: LoadState[] = []
  const displays: (Event | undefined)[] = []
  const le = createLazyEase({ loader: webpLoader, onStateChange: (state) => states.push(state), ...config })
  const dom = boxed(imgAttributes)
  const attach = (options: AttachOptions) =>
    le.attach(dom.img, { onDisplay: (_, event) => displays.push(event), ...options })
  return { le, ...dom, states, displays, attach }
}

/** Runs a decode and lets the reveal happen. */
async function loadAndDecode(img: HTMLImageElement, url?: string) {
  load(img, url)
  await flush()
}

describe('prepared mode', () => {
  it('copies the prepared values on intersection, sizes before srcset, and fades in', async () => {
    const { img, box, attach, states, displays } = setup()
    const order: string[] = []
    const setAttribute = img.setAttribute.bind(img)
    vi.spyOn(img, 'setAttribute').mockImplementation((name, value) => {
      order.push(name)
      setAttribute(name, value)
    })
    const handle = attach({ srcset: '/a-640.webp 640w, /a-1280.webp 1280w', sizes: '50vw', url: '/a-640.webp' })
    expect(handle.state).toBe('idle')
    expect(box.getAttribute('data-state')).toBe('idle')
    expect(img.hasAttribute('srcset')).toBe(false)

    intersect(box)
    expect(order.slice(0, 3)).toEqual(['sizes', 'srcset', 'src'])
    expect(img.getAttribute('srcset')).toBe('/a-640.webp 640w, /a-1280.webp 1280w')
    expect(img.getAttribute('src')).toBe('/a-640.webp')
    expect(img.style.opacity).toBe('0')
    expect(states).toEqual(['idle', 'loading'])

    await loadAndDecode(img)
    expect(states).toEqual(['idle', 'loading', 'loaded'])
    expect(box.getAttribute('data-state')).toBe('loaded')
    expect(img.style.opacity).toBe('1')
    expect(img.style.transition).toBe('opacity 400ms ease-out')
    expect(displays).toHaveLength(1)
    expect(displays[0]).toBeInstanceOf(Event)
    // The placeholder stays for the fade, then goes (transparent images).
    expect(box.style.backgroundColor).toBe(PLACEHOLDER)
    vi.advanceTimersByTime(400)
    expect(box.style.backgroundColor).toBe('')
    expect(img.style.opacity).toBe('')
    expect(img.style.transition).toBe('')
  })

  it('needs no loader and reads no layout for a prepared slot', () => {
    const loader = vi.fn((request: ImageRequest) => `/x?w=${request.width}`)
    const { img, box, attach } = setup({ loader })
    const read = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    attach({ url: '/hero.webp' })
    intersect(box)
    expect(img.getAttribute('src')).toBe('/hero.webp')
    expect(loader).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(MockResizeObserver.instances).toHaveLength(0)
  })

  it('activates deferred picture sources before the fallback img', () => {
    document.body.innerHTML = `<span data-le><picture>
      <source media="(min-width:800px)" data-le-sizes="100vw" data-le-srcset="/wide-1440.webp 1440w, /wide-2560.webp 2560w">
      <img alt="Cliffs" src="${INERT}"></picture></span>`
    const img = document.querySelector('img')!
    const source = document.querySelector('source')!
    fakeImage(img)
    const order: string[] = []
    for (const element of [img, source]) {
      const set = element.setAttribute.bind(element)
      vi.spyOn(element, 'setAttribute').mockImplementation((name, value) => {
        order.push(`${element.tagName.toLowerCase()}.${name}`)
        set(name, value)
      })
    }
    createLazyEase().attach(img, { srcset: '/sq-750.webp 750w', sizes: '100vw', loading: 'eager' })
    expect(source.getAttribute('srcset')).toBe('/wide-1440.webp 1440w, /wide-2560.webp 2560w')
    expect(source.getAttribute('sizes')).toBe('100vw')
    expect(order.filter((step) => step !== 'img.data-state')).toEqual(['source.sizes', 'source.srcset', 'img.sizes', 'img.srcset'])
  })

  it('hard-swaps a boxless image whose data-URI src is the placeholder', async () => {
    document.body.innerHTML = `<img data-le alt="Fern" src="data:image/png;base64,AAAA">`
    const img = document.querySelector('img')!
    fakeImage(img)
    createLazyEase().attach(img, { url: '/fern.webp', loading: 'eager' })
    expect(img.style.opacity).toBe('')
    expect(img.getAttribute('src')).toBe('/fern.webp')
    expect(img.getAttribute('data-state')).toBe('loading')
    await loadAndDecode(img)
    expect(img.getAttribute('data-state')).toBe('loaded')
    expect(img.style.opacity).toBe('')
  })
})

describe('display lifecycle', () => {
  it('ignores the placeholder’s own load, before and after the target is assigned', async () => {
    const { img, box, attach, states, displays } = setup()
    attach({ url: '/a.webp' })
    load(img, INERT)
    await flush()
    expect(states).toEqual(['idle'])
    intersect(box)
    load(img, INERT)
    await flush()
    expect(states).toEqual(['idle', 'loading'])
    expect(displays).toHaveLength(0)
    await loadAndDecode(img, '/a.webp')
    expect(states.at(-1)).toBe('loaded')
  })

  it('adopts an already displayed target without an event or a fade', () => {
    const { img, attach, states, displays } = setup({}, 'srcset="/a-640.webp 640w"')
    Object.assign(img, { complete: true, naturalWidth: 640, currentSrc: '/a-640.webp' })
    attach({ srcset: '/a-640.webp 640w', sizes: '100vw' })
    expect(states).toEqual(['loaded'])
    expect(displays).toEqual([undefined])
    expect(img.style.opacity).toBe('')
  })

  it('adopts a cached image that failed as an error', () => {
    const { img, box, attach, states } = setup({}, 'src="/gone.webp"')
    img.setAttribute('src', '/gone.webp')
    Object.assign(img, { complete: true, naturalWidth: 0 })
    attach({ url: '/gone.webp' })
    expect(states).toEqual(['error'])
    expect(box.style.backgroundColor).toBe('')
  })

  it('keeps an adopted error when activation installs the same source', () => {
    for (const loading of ['eager', 'lazy'] as const) {
      const { img, box, attach, states } = setup()
      img.setAttribute('src', '/gone.webp')
      Object.assign(img, { complete: true, naturalWidth: 0 })
      const handle = attach({ url: '/gone.webp', loading })
      intersect(box)
      expect(states).toEqual(['error'])
      expect(handle.state).toBe('error')
      expect(box.getAttribute('data-state')).toBe('error')
      expect(img.style.opacity).toBe('')
    }
  })

  it('still loads a different source after an adopted error', () => {
    const { img, box, attach, states } = setup({}, 'srcset="/gone-640.webp 640w" sizes="100vw"')
    img.setAttribute('src', '/gone.webp')
    Object.assign(img, { complete: true, naturalWidth: 0 })
    attach({ url: '/fern.webp', loading: 'eager' })
    expect(states).toEqual(['error', 'loading'])
    expect(img.hasAttribute('srcset')).toBe(false)
    expect(img.getAttribute('src')).toBe('/fern.webp')
    expect(box.getAttribute('data-state')).toBe('loading')
  })

  it('waits for a decode that resolves', async () => {
    const { img, box, attach, states, fake } = setup()
    attach({ url: '/a.webp', loading: 'eager' })
    load(img)
    expect(states.at(-1)).toBe('loading')
    await flush()
    expect(fake.decodes).toBe(1)
    expect(states.at(-1)).toBe('loaded')
    expect(box.getAttribute('data-state')).toBe('loaded')
  })

  it('treats a rejected decode of the first load as an error, keeping the reserved box', async () => {
    const { img, box, attach, states, fake, displays } = setup()
    fake.decodeWith = 'reject'
    attach({ url: '/broken.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(states.at(-1)).toBe('error')
    expect(displays).toHaveLength(0)
    expect(box.style.backgroundColor).toBe('')
    // The alt text / broken-image presentation shows again.
    expect(img.style.opacity).toBe('')
    expect(box.style.display).toBe('block')
  })

  it('reveals after the decode timeout when decode never settles', async () => {
    const { img, attach, states, fake } = setup({ decodeTimeout: 100 })
    fake.decodeWith = 'hang'
    attach({ url: '/a.webp', loading: 'eager' })
    load(img)
    await vi.advanceTimersByTimeAsync(99)
    expect(states.at(-1)).toBe('loading')
    await vi.advanceTimersByTimeAsync(1)
    expect(states.at(-1)).toBe('loaded')
  })

  it('reports an initial load error and releases the placeholder', async () => {
    const { img, box, attach, states, displays } = setup()
    attach({ url: '/missing.webp', loading: 'eager' })
    expect(img.style.opacity).toBe('0')
    fail(img)
    expect(states.at(-1)).toBe('error')
    expect(box.getAttribute('data-state')).toBe('error')
    expect(box.style.backgroundColor).toBe('')
    expect(img.style.opacity).toBe('')
    expect(displays).toHaveLength(0)
  })

  it('swaps directly with reduced motion', async () => {
    media.reducedMotion = true
    const { img, box, attach } = setup()
    attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(img.style.opacity).toBe('')
    expect(img.style.transition).toBe('')
    expect(box.style.backgroundColor).toBe('')
  })

  it('swaps directly with a zero fade', async () => {
    const { img, box, attach } = setup({ fadeDuration: 0 })
    attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(img.style.transition).toBe('')
    expect(box.style.backgroundColor).toBe('')
  })

  it('reports the first display once per logical source', async () => {
    const { img, attach, displays } = setup()
    const handle = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    await loadAndDecode(img)
    expect(displays).toHaveLength(1)
    handle.update({ url: '/b.webp', loading: 'eager', onDisplay: (_, event) => displays.push(event) })
    await loadAndDecode(img)
    expect(displays).toHaveLength(2)
  })

  it('ignores a decode that finishes after the source moved on', async () => {
    const { img, attach, states, fake } = setup()
    fake.decodeWith = 'hang'
    attach({ url: '/a.webp', loading: 'eager' })
    load(img, '/a.webp')
    Object.assign(img, { currentSrc: '/a-bigger.webp' })
    await vi.advanceTimersByTimeAsync(250)
    expect(states.at(-1)).toBe('loading')
  })
})

describe('generations', () => {
  it('starts a new source from its placeholder; stale completions cannot touch it', async () => {
    const { img, box, attach, states } = setup()
    const handle = attach({ url: '/a.webp', loading: 'eager' })
    load(img, '/a.webp')
    // The old decode is still pending when the source changes.
    handle.update({ url: '/b.webp' })
    expect(img.getAttribute('src')).toBe(INERT)
    expect(box.style.backgroundColor).toBe(PLACEHOLDER)
    expect(states.at(-1)).toBe('idle')
    await flush()
    expect(states.at(-1)).toBe('idle')
    expect(handle.state).toBe('idle')
    fail(img)
    expect(states.at(-1)).toBe('idle')
    intersect(box)
    expect(img.getAttribute('src')).toBe('/b.webp')
    await loadAndDecode(img, '/b.webp')
    expect(handle.state).toBe('loaded')
  })

  it('validates new options before ending the current generation', async () => {
    const { img, attach } = setup()
    const handle = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(() => handle.update({ src: '/b.jpg', url: '/b.webp' })).toThrow(TypeError)
    expect(img.getAttribute('src')).toBe('/a.webp')
    expect(handle.state).toBe('loaded')
  })

  it('destroy releases listeners, observers, timers and ownership', async () => {
    const { img, box, attach, states } = setup({ dwellTime: 300 })
    const handle = attach({ url: '/a.webp' })
    const [observer] = MockIntersectionObserver.instances
    intersect(box)
    handle.destroy()
    expect(observer!.disconnected).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(img.hasAttribute('src') && img.getAttribute('src')).toBe(INERT)
    load(img)
    await flush()
    expect(states).toEqual(['idle'])
    // Ownership is free again.
    createLazyEase().attach(img, { url: '/a.webp' }).destroy()
  })

  it('finishes a fade cut short by destroy', async () => {
    const { img, box, attach } = setup()
    const handle = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(img.style.transition).not.toBe('')
    handle.destroy()
    expect(img.style.opacity).toBe('')
    expect(img.style.transition).toBe('')
    expect(box.style.backgroundColor).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows a target still loading when destroy ends the generation, over the placeholder', async () => {
    const { img, box, attach } = setup()
    const handle = attach({ url: '/a.webp', loading: 'eager' })
    expect(img.style.opacity).toBe('0')
    handle.destroy()
    expect(img.style.opacity).toBe('')
    expect(img.style.transition).toBe('')
    expect(img.getAttribute('src')).toBe('/a.webp')
    // The element keeps what it displays: the placeholder, until the image arrives.
    expect(box.style.backgroundColor).toBe(PLACEHOLDER)
    load(img)
    await flush()
    expect(img.style.opacity).toBe('')
  })

  it('leaves an opacity it did not set alone on destroy', () => {
    const { img, attach } = setup({}, 'style="opacity:0.5"')
    attach({ url: '/a.webp' }).destroy()
    expect(img.style.opacity).toBe('0.5')
  })

  it('puts the focus styles back on update, and keeps them through destroy', () => {
    const { img, box, attach } = setup({}, 'style="object-position:left top"')
    const fern: AttachOptions = { src: '/fern.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, focalPoint: { x: 70, y: 40 }, loading: 'eager' }
    const handle = attach(fern)
    resize(box, 300, 300)
    expect(img.style.getPropertyValue('object-position')).toContain('clamp(')
    expect(box.style.getPropertyValue('container-type')).toBe('size')
    // A re-measure replaces them without stacking.
    resize(box, 900, 300)
    vi.advanceTimersByTime(200)
    handle.update({ src: '/moss.jpg', fill: true, loading: 'eager' })
    expect(img.style.getPropertyValue('object-position')).toBe('left top')
    expect(box.style.getPropertyValue('container-type')).toBe('')
    handle.update(fern)
    resize(box, 300, 300)
    handle.destroy()
    // The element keeps what it displays, crop included.
    expect(img.style.getPropertyValue('object-position')).toContain('clamp(')
  })

  it('resets the picture sources it activated when the source changes', () => {
    document.body.innerHTML = `<span data-le><picture>
      <source media="(min-width:800px)" srcset="${INERT}" data-le-sizes="100vw" data-le-srcset="/wide-1440.webp 1440w">
      <img alt="Cliffs" src="${INERT}"></picture></span>`
    const box = document.querySelector('span')!
    const img = document.querySelector('img')!
    const source = document.querySelector('source')!
    fakeImage(img)
    const handle = createLazyEase().attach(img, { srcset: '/sq-750.webp 750w', sizes: '100vw', loading: 'eager' })
    expect(source.getAttribute('srcset')).toBe('/wide-1440.webp 1440w')
    handle.update({ srcset: '/sq2-750.webp 750w', sizes: '100vw' })
    expect(source.getAttribute('srcset')).toBe(INERT)
    expect(source.hasAttribute('sizes')).toBe(false)
    expect(img.getAttribute('src')).toBe(INERT)
    intersect(box)
    expect(source.getAttribute('srcset')).toBe('/wide-1440.webp 1440w')
    expect(source.getAttribute('sizes')).toBe('100vw')
  })

  it('keeps the displayed image through destroy and adopts it on a new attach', async () => {
    const { le, img, attach, displays } = setup()
    attach({ url: '/a.webp', loading: 'eager' }).destroy()
    // Attached again (a remount) before the image loaded: it still fades in.
    const second = le.attach(img, { url: '/a.webp', loading: 'eager' })
    expect(second.state).toBe('loading')
    await loadAndDecode(img, '/a.webp')
    expect(second.state).toBe('loaded')
    second.destroy()
    // And once loaded, a third attach adopts it at once.
    const third = le.attach(img, { url: '/a.webp', onDisplay: (_, event) => displays.push(event) })
    expect(third.state).toBe('loaded')
    expect(displays).toEqual([undefined])
  })
})

describe('validation', () => {
  it.each<[string, AttachOptions]>([
    ['measured and prepared', { src: '/a.jpg', srcset: '/a.webp 640w' }],
    ['measured and url', { src: '/a.jpg', url: '/a.webp' }],
    ['no source', {}],
    ['sizes without srcset', { url: '/a.webp', sizes: '100vw' }],
    ['native with sources', { priority: true, src: '/a.jpg' }],
    ['height without width', { src: '/a.jpg', height: 10 }],
    ['fill with width', { src: '/a.jpg', fill: true, width: 10 }],
    ['width, height and ratio', { src: '/a.jpg', width: 10, height: 10, aspectRatio: 1 }],
    ['browser crop without dimensions', { src: '/a.jpg', fill: true, crop: 'browser' }],
    ['non-finite focus', { src: '/a.jpg', fill: true, focalPoint: { x: Number.NaN, y: 10 } }],
    ['bad placeholder', { src: '/a.jpg', placeholder: 'red; color: blue' }],
    ['thumbhash without a decoder', { src: '/a.jpg', placeholder: 'thumbhash:1QcSHQRnh493V4dIh4eXh1h4kJUI' }],
    ['a measured source without a loader', { src: '/a.jpg', loader: undefined }],
  ])('rejects %s before touching the element', (_, options) => {
    const { img, box } = setup()
    const before = document.body.innerHTML
    expect(() => createLazyEase(options.loader === undefined && 'loader' in options ? {} : { loader: webpLoader }).attach(img, options)).toThrow(TypeError)
    expect(document.body.innerHTML).toBe(before)
    expect(box.hasAttribute('data-state')).toBe(false)
    // Not claimed either.
    createLazyEase().attach(img, { url: '/a.webp' }).destroy()
  })
})

describe('ownership', () => {
  it('refuses a second attachment until the owner releases it', () => {
    const { img } = setup()
    const first = createLazyEase().attach(img, { url: '/a.webp' })
    expect(() => createLazyEase().attach(img, { url: '/a.webp' })).toThrow(/already attached/)
    first.destroy()
    first.destroy()
    createLazyEase().attach(img, { url: '/a.webp' })
    // A stale handle cannot release the new owner's claim.
    first.destroy()
    expect(() => createLazyEase().attach(img, { url: '/a.webp' })).toThrow(/already attached/)
  })

  it('is shared by separate copies of the package', async () => {
    // A second module instance, as a second bundle on the page would have.
    const path = '../src/dom/controller.js?copy'
    const copy = (await import(/* @vite-ignore */ path)) as typeof import('../src/dom/controller.js')
    expect(copy.createLazyEase).not.toBe(createLazyEase)
    const { img, box } = setup()
    const handle = createLazyEase().attach(img, { url: '/a.webp' })
    expect(() => copy.createLazyEase().attach(img, { url: '/a.webp' })).toThrow(/already attached/)
    handle.destroy()
    const other = copy.createLazyEase().attach(img, { url: '/a.webp', loading: 'eager' })
    expect(box.getAttribute('data-state')).toBe('loading')
    other.destroy()
  })
})

describe('visibility', () => {
  it('shares one observer per root and margin and disposes empty pools', () => {
    document.body.innerHTML = `<div id="panel"></div><span data-le><img src="${INERT}"></span><span data-le><img src="${INERT}"></span><span data-le><img src="${INERT}"></span>`
    const panel = document.getElementById('panel')!
    const [a, b, c] = [...document.querySelectorAll('img')]
    const le = createLazyEase()
    const ha = le.attach(a!, { url: '/a.webp' })
    const hb = le.attach(b!, { url: '/b.webp' })
    expect(MockIntersectionObserver.instances).toHaveLength(1)
    expect(MockIntersectionObserver.instances[0]!.options).toMatchObject({ root: null, rootMargin: '400px', scrollMargin: '400px' })
    const hc = le.attach(c!, { url: '/c.webp', root: panel, rootMargin: '100px' })
    expect(MockIntersectionObserver.instances).toHaveLength(2)
    expect(MockIntersectionObserver.instances[1]!.options).toMatchObject({ root: panel, rootMargin: '100px' })
    ha.destroy()
    expect(MockIntersectionObserver.instances[0]!.disconnected).toBe(false)
    hb.destroy()
    hc.destroy()
    expect(MockIntersectionObserver.instances.every((o) => o.disconnected)).toBe(true)
    le.attach(a!, { url: '/a.webp' })
    expect(MockIntersectionObserver.instances).toHaveLength(3)
  })

  it('waits for the dwell time, and leaving earlier cancels', () => {
    const { img, box, attach } = setup({ dwellTime: 300 })
    attach({ url: '/a.webp' })
    intersect(box)
    vi.advanceTimersByTime(299)
    intersect(box, false)
    vi.advanceTimersByTime(500)
    expect(img.getAttribute('src')).toBe(INERT)
    intersect(box)
    vi.advanceTimersByTime(300)
    expect(img.getAttribute('src')).toBe('/a.webp')
  })

  it('runs every whenVisible subscription of one element, and disposing one keeps the others', () => {
    document.body.innerHTML = '<div></div>'
    const element = document.querySelector('div')!
    const calls: string[] = []
    const observe = vi.spyOn(MockIntersectionObserver.prototype, 'observe')
    const disposeA = whenVisible(element, {}, () => calls.push('a'))
    whenVisible(element, {}, () => calls.push('b'))
    const disposeC = whenVisible(element, {}, () => calls.push('c'))
    // Observed again for every subscription, so each gets an initial entry.
    expect(observe).toHaveBeenCalledTimes(3)
    disposeC()
    intersect(element)
    expect(calls).toEqual(['a', 'b'])
    // Both fired and unsubscribed; a late dispose changes nothing.
    disposeA()
    expect(MockIntersectionObserver.instances[0]!.disconnected).toBe(true)
  })

  it('keeps a dwell running when a later subscription repeats the entry', () => {
    document.body.innerHTML = '<div></div>'
    const element = document.querySelector('div')!
    const calls: string[] = []
    whenVisible(element, { dwellTime: 300 }, () => calls.push('a'))
    intersect(element)
    vi.advanceTimersByTime(200)
    whenVisible(element, { dwellTime: 300 }, () => calls.push('b'))
    intersect(element)
    vi.advanceTimersByTime(100)
    expect(calls).toEqual(['a'])
    vi.advanceTimersByTime(200)
    expect(calls).toEqual(['a', 'b'])
  })

  it('reports sizes to every observeResize subscription of one element', () => {
    document.body.innerHTML = '<div></div>'
    const element = document.querySelector('div')!
    const sizes: number[] = []
    const callback = (width: number) => sizes.push(width)
    const first = observeResize(element, callback)
    const second = observeResize(element, callback)
    resize(element, 10, 10)
    expect(sizes).toEqual([10, 10])
    first()
    resize(element, 20, 20)
    expect(sizes).toEqual([10, 10, 20])
    second()
    resize(element, 30, 30)
    expect(sizes).toEqual([10, 10, 20])
  })

  it('observes against a custom root', () => {
    document.body.innerHTML = `<div id="panel"><span data-le><img src="${INERT}"></span></div>`
    const panel = document.getElementById('panel')!
    const img = document.querySelector('img')!
    createLazyEase({ root: panel, rootMargin: '0px' }).attach(img, { url: '/a.webp' })
    expect(MockIntersectionObserver.instances[0]!.options).toMatchObject({ root: panel, rootMargin: '0px' })
  })

  it('loads at once without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { img, attach } = setup()
    attach({ url: '/a.webp' })
    expect(img.getAttribute('src')).toBe('/a.webp')
  })
})

describe('measured mode', () => {
  it('installs candidates for the measured content box with actual-width labels', () => {
    const { img, box, attach } = setup()
    // A 300 px high strip cropped square: requests above 300 encode 300 px.
    attach({ src: '/strip.jpg', width: 320, height: 320, srcWidth: 2000, srcHeight: 300 })
    intersect(box)
    expect(img.hasAttribute('srcset')).toBe(false)
    resize(box, 320, 320)
    const url = (w: number) => `/_img/strip.jpg?ar=1&fmt=webp&q=75&w=${w}`
    expect(img.getAttribute('srcset')).toBe(`${url(64)} 64w, ${url(128)} 128w, ${url(256)} 256w, ${url(384)} 300w`)
    expect(img.getAttribute('sizes')).toBe('320px')
    expect(img.getAttribute('src')).toBe(INERT)
  })

  it('collapses to a single URL with the largest request when the source size is unknown', () => {
    const { img, box, attach } = setup()
    attach({ src: '/lake.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 300, 300)
    expect(img.hasAttribute('srcset')).toBe(false)
    expect(img.hasAttribute('sizes')).toBe(false)
    expect(img.getAttribute('src')).toBe('/_img/lake.jpg?ar=1&fmt=webp&q=75&w=640')
  })

  it('passes the crop token and revision to the loader', () => {
    const { img, box, attach } = setup()
    attach({ src: '/cliff.jpg', aspectRatio: 1, focalPoint: { x: 30, y: 45 }, version: 'r7', token: '1.k1.WisYCsz8Vtmygcbr01tTuA', loading: 'eager' })
    resize(box, 300, 300)
    expect(img.getAttribute('src')).toBe('/_img/cliff.jpg?ar=1&fmt=webp&fx=30&fy=45&q=75&token=1.k1.WisYCsz8Vtmygcbr01tTuA&v=r7&w=640')
  })

  it('ignores zero-sized slots until they get a size', () => {
    const { img, box, attach, states } = setup()
    attach({ src: '/lake.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, loading: 'eager' })
    resize(box, 0, 0)
    resize(box, 300, 0)
    expect(img.hasAttribute('srcset')).toBe(false)
    expect(states).toEqual(['idle'])
    resize(box, 300, 200)
    expect(img.getAttribute('sizes')).toBe('300px')
    expect(states).toEqual(['idle', 'loading'])
  })

  it('survives being detached and reattached', () => {
    const { img, box, attach } = setup()
    attach({ src: '/lake.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, loading: 'eager' })
    box.remove()
    resize(box, 0, 0)
    expect(img.hasAttribute('srcset')).toBe(false)
    document.body.append(box)
    resize(box, 300, 200)
    expect(img.getAttribute('sizes')).toBe('300px')
  })

  it('grows the ladder after the trailing debounce and never shrinks', () => {
    const { img, box, attach } = setup()
    attach({ src: '/lake.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, loading: 'eager' })
    resize(box, 300, 200)
    const first = img.getAttribute('srcset')
    resize(box, 900, 600)
    resize(box, 1000, 600)
    vi.advanceTimersByTime(199)
    expect(img.getAttribute('srcset')).toBe(first)
    vi.advanceTimersByTime(1)
    expect(img.getAttribute('sizes')).toBe('1000px')
    expect(img.getAttribute('srcset')).toContain('w=1920')
    resize(box, 200, 100)
    vi.advanceTimersByTime(200)
    expect(img.getAttribute('sizes')).toBe('1000px')
  })

  it('uses the cover width for browser crop, even when only the height grows', () => {
    const { img, box, attach } = setup()
    // 3:2 source in fill mode without a ratio: browser crop.
    attach({ src: '/fern.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, loading: 'eager' })
    resize(box, 300, 300)
    expect(img.getAttribute('sizes')).toBe('450px')
    expect(img.getAttribute('srcset')).not.toContain('ar=')
    resize(box, 300, 600)
    vi.advanceTimersByTime(200)
    expect(img.getAttribute('sizes')).toBe('900px')
    expect(img.getAttribute('srcset')).toContain('w=1920')
  })

  it('crops on the server with the measured box ratio when the source size is unknown', () => {
    const { img, box, attach } = setup()
    attach({ src: '/fern.jpg', fill: true, loading: 'eager' })
    resize(box, 400, 300)
    expect(img.getAttribute('src')).toBe('/_img/fern.jpg?ar=1.333&fmt=webp&q=75&w=828')
  })

  it('keeps the displayed image when an upgrade fails', async () => {
    const { img, box, attach, states } = setup()
    attach({ src: '/lake.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, loading: 'eager' })
    resize(box, 300, 200)
    await loadAndDecode(img)
    const shown = img.getAttribute('srcset')
    resize(box, 1200, 800)
    vi.advanceTimersByTime(200)
    expect(img.getAttribute('srcset')).not.toBe(shown)
    fail(img)
    expect(img.getAttribute('srcset')).toBe(shown)
    expect(img.getAttribute('sizes')).toBe('300px')
    expect(states.at(-1)).toBe('loaded')
    // A restored list that fails again is not retried in a loop.
    const set = vi.spyOn(img, 'setAttribute')
    fail(img)
    expect(set).not.toHaveBeenCalled()
  })

  it('passes external, SVG and GIF sources through untouched', () => {
    for (const src of ['https://images.example.org/fern.jpg?x=1#y', '/logo.svg', '/wave.GIF', 'data:image/svg+xml,%3Csvg%3E']) {
      const url = vi.fn(() => '/never')
      const { img, attach } = setup({ loader: { url, widths: [64], qualities: [75], formats: ['webp'] } })
      attach({ src, width: 120, height: 40, loading: 'eager' })
      expect(img.getAttribute('src')).toBe(src)
      expect(url).not.toHaveBeenCalled()
      expect(MockResizeObserver.instances).toHaveLength(0)
    }
  })

  it('loads owned domains through the loader', () => {
    const { img, box, attach } = setup({ domains: ['cdn.example.org'] })
    attach({ src: 'https://cdn.example.org/fern.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toBe('/_img/fern.jpg?ar=1&fmt=webp&q=75&w=256')
  })

  it('places the focal point with container units', () => {
    const { img, box, attach } = setup()
    attach({ src: '/fern.jpg', fill: true, srcWidth: 2400, srcHeight: 1600, focalPoint: { x: 70, y: 40 }, loading: 'eager' })
    resize(box, 300, 300)
    expect(box.style.getPropertyValue('container-type')).toBe('size')
    expect(img.style.getPropertyValue('object-position')).toContain('clamp(')
  })

  it('sends the focal point with a server crop', () => {
    const { img, box, attach } = setup()
    attach({ src: '/fern.jpg', width: 56, height: 56, focalPoint: { x: 40, y: 30 }, loading: 'eager' })
    resize(box, 56, 56)
    expect(img.getAttribute('src')).toBe('/_img/fern.jpg?ar=1&fmt=webp&fx=40&fy=30&q=75&w=128')
  })
})

describe('formats', () => {
  it('needs no probe for a single format', () => {
    const { img, box, attach } = setup()
    attach({ src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 100, 100)
    expect(probe.created).toBe(0)
    expect(img.getAttribute('src')).toContain('fmt=webp')
  })

  it('passes auto to an auto-negotiating loader without probing', () => {
    const url = vi.fn((r: ImageRequest) => `/cdn${r.src}?w=${r.width}&f=${r.format}`)
    const { img, box, attach } = setup({ loader: { url, widths: [100, 200], qualities: [75], formats: 'auto' } })
    attach({ src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 100, 100)
    expect(probe.created).toBe(0)
    expect(img.getAttribute('src')).toBe('/cdn/a.jpg?w=200&f=auto')
  })

  it('probes once on first need and takes the best declared format', async () => {
    const le = createLazyEase({ loader: createLoader() })
    expect(probe.created).toBe(0)
    const { img, box } = boxed()
    le.attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    await flush()
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=avif')
    expect(probe.created).toBe(1)
  })

  it('falls back to WebP when detection takes longer than 200 ms', async () => {
    probe.hang = true
    const { img, box } = boxed()
    createLazyEase({ loader: createLoader() }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    await vi.advanceTimersByTimeAsync(200)
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=webp')
  })

  it('takes WebP, or the next declared format, when the browser does not decode AVIF', async () => {
    probe.avif = false
    const { img, box } = boxed()
    createLazyEase({ loader: createLoader() }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    await flush()
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=webp')
    const other = boxed()
    createLazyEase({ loader: createLoader({ formats: ['avif', 'jpeg'] }) }).attach(other.img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(other.box, 100, 100)
    expect(other.img.getAttribute('src')).toContain('fmt=jpeg')
    expect(probe.created).toBe(1)
  })
})

describe('native and priority images', () => {
  it('leaves a native image visible and reports its load', () => {
    const { img, box, attach, states, displays } = setup({}, 'srcset="/a-640.webp 640w" sizes="100vw"')
    attach({ loading: 'native' })
    expect(states).toEqual(['loading'])
    expect(img.style.opacity).toBe('')
    load(img)
    expect(states).toEqual(['loading', 'loaded'])
    expect(displays).toHaveLength(1)
    expect(MockIntersectionObserver.instances).toHaveLength(0)
    expect(box.style.backgroundColor).toBe('')
  })

  it('adopts the new sources of a native update instead of blanking the image', async () => {
    const { img, box, attach, states, displays } = setup({}, 'srcset="/a-640.webp 640w" sizes="100vw"')
    const handle = attach({ priority: true })
    load(img)
    expect(handle.state).toBe('loaded')
    // A framework commits the new hero's attributes, then updates.
    img.setAttribute('srcset', '/b-640.webp 640w')
    Object.assign(img, { complete: false })
    handle.update({ priority: true, onDisplay: (_, event) => displays.push(event) })
    expect(img.getAttribute('srcset')).toBe('/b-640.webp 640w')
    expect(img.getAttribute('sizes')).toBe('100vw')
    expect(handle.state).toBe('loading')
    load(img)
    await flush()
    expect(handle.state).toBe('loaded')
    expect(box.getAttribute('data-state')).toBe('loaded')
    expect(displays).toHaveLength(2)
    expect(states.slice(-2)).toEqual(['loading', 'loaded'])
  })

  it('takes native sources set after the update', () => {
    const { img, attach } = setup()
    const handle = attach({ loading: 'native' })
    expect(handle.state).toBe('idle')
    handle.update({ loading: 'native' })
    expect(handle.state).toBe('idle')
    load(img)
    expect(handle.state).toBe('idle')
    img.setAttribute('src', '/b.webp')
    load(img)
    expect(handle.state).toBe('loaded')
  })

  it('keeps a displayed image through a native update and adopts it', () => {
    const { img, attach, displays } = setup({}, 'srcset="/a-640.webp 640w" sizes="100vw"')
    const handle = attach({ loading: 'native' })
    load(img)
    handle.update({ loading: 'native', onDisplay: (_, event) => displays.push(event) })
    expect(img.getAttribute('srcset')).toBe('/a-640.webp 640w')
    expect(handle.state).toBe('loaded')
    expect(displays).toEqual([expect.any(Event), undefined])
  })

  it('gives a priority image eager loading and high fetch priority', () => {
    const { img, attach } = setup({}, 'srcset="/a-640.webp 640w" sizes="100vw"')
    attach({ priority: true })
    expect(img.getAttribute('fetchpriority')).toBe('high')
    expect(img.getAttribute('loading')).toBe('eager')
  })
})

describe('placeholders', () => {
  it('paints a color or data URI placeholder on the box', () => {
    const { box, attach } = setup()
    attach({ url: '/a.webp', placeholder: '#123456' })
    expect(box.style.backgroundColor).toBe('rgb(18, 52, 86)')
    const other = setup()
    other.attach({ url: '/a.webp', placeholder: 'data:image/png;base64,AAAA' })
    expect(other.box.style.backgroundImage).toContain('data:image/png;base64,AAAA')
  })

  it('shows a ThumbHash color first and decodes the image when the image is about to load', () => {
    const lazy = vi.fn(() => ({ backgroundColor: '#010203', backgroundImage: 'url("data:image/png;base64,BBBB")' }))
    const thumbhash = vi.fn(() => ({ style: { backgroundColor: '#010203' }, lazy }))
    const { box, attach } = setup({ thumbhash })
    attach({ url: '/a.webp', placeholder: 'thumbhash:abc' })
    expect(thumbhash).toHaveBeenCalledWith('abc')
    expect(box.style.backgroundColor).toBe('rgb(1, 2, 3)')
    expect(lazy).not.toHaveBeenCalled()
    intersect(box)
    expect(lazy).toHaveBeenCalledOnce()
    expect(box.style.backgroundImage).toContain('BBBB')
  })
})
