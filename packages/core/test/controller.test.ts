// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createLazyEase, createLoader, detectAvif, focusReveal, whenVisible, type AttachOptions, type Attachment, type ImageFormat, type ImageRequest, type LazyEaseConfig, type LoadState } from '../src/index.js'
import { createLazyEase as createPrepared } from '../src/prepared.js'
import { resetFormatDetection } from '../src/dom/format.js'
import { thumbhashDecoder } from '../src/thumbhash.js'
import { observeResize, resetObservers } from '../src/dom/observe.js'
import { fail, fakeImage, flush, installDom, intersect, load, media, mockAnimate, MockIntersectionObserver, MockResizeObserver, probe, recordLayoutReads, resize } from './dom-mocks.js'

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

  it('starts the fade from opacity 0 with an animation, not a style flush', async () => {
    const { img, box, attach } = setup()
    const animations = mockAnimate(img)
    const reads = recordLayoutReads()
    attach({ url: '/a-640.webp' })
    intersect(box)
    // Load and decode in the same frame as the install: no frame resolved opacity 0 yet.
    await loadAndDecode(img)
    expect(animations).toMatchObject([{ keyframes: { opacity: [0, 1], easing: 'ease-out' }, duration: 400, cancelled: false }])
    expect(img.style.opacity).toBe('1')
    expect(img.style.transition).toBe('opacity 400ms ease-out')
    vi.advanceTimersByTime(400)
    expect(box.style.backgroundColor).toBe('')
    expect(img.style.opacity).toBe('')
    expect(reads).toEqual([])
  })

  // A decoder whose placeholder stands for a transparent image, as `thumbhashDecoder()` returns for a hash with alpha.
  const alphaHash = () => ({ style: {}, lazy: () => ({ backgroundImage: 'url("data:image/png;base64,AAAA")' }), transparent: true })

  it('fades a transparent placeholder out while the image becomes opaque, so a transparent image crossfades', async () => {
    const { img, box, attach } = setup({ thumbhash: alphaHash })
    mockAnimate(img)
    const out = mockAnimate(box)
    attach({ url: '/logo.webp', loading: 'eager', placeholder: 'thumbhash:AAAA' })
    expect(box.style.backgroundColor).toBe('')
    await loadAndDecode(img)
    // Only what it painted inline: the decoded image, no color.
    expect(out).toMatchObject([{ keyframes: { backgroundImage: `url(${INERT})` }, duration: { duration: 160, delay: 160, fill: 'forwards' }, cancelled: false }])
    expect(out[0]!.keyframes).not.toHaveProperty('backgroundColor')
    // The placeholder is still painted underneath; the animation only covers it.
    expect(box.style.backgroundImage).toContain('AAAA')
    vi.advanceTimersByTime(400)
    expect(out[0]!.cancelled).toBe(true)
    expect(box.style.backgroundImage).toBe('')
  })

  it('fades out the inline placeholder the caller marks transparent', async () => {
    const { img, box, attach } = setup()
    mockAnimate(img)
    const out = mockAnimate(box)
    attach({ url: '/logo.webp', loading: 'eager', transparent: true })
    await loadAndDecode(img)
    expect(out).toMatchObject([{ keyframes: { backgroundColor: 'transparent' } }])
    expect(out[0]!.keyframes).not.toHaveProperty('backgroundImage')
    vi.advanceTimersByTime(400)
    expect(box.style.backgroundColor).toBe('')
  })

  it('keeps every other placeholder under the image until the fade ends', async () => {
    const opaqueHash = () => ({ style: { backgroundColor: 'red' }, lazy: () => ({ backgroundImage: 'url("data:image/png;base64,AAAA")' }) })
    // No placeholder option (what the HTML paints), a color, a data URI, 'none', an opaque ThumbHash; with and without a reveal.
    for (const placeholder of [undefined, 'blue', 'data:image/png;base64,AAAA', 'none', 'thumbhash:AAAA']) {
      for (const reveal of [undefined, focusReveal]) {
        const { img, box, attach } = setup({ reveal, thumbhash: opaqueHash })
        mockAnimate(img)
        const out = mockAnimate(box)
        attach({ url: '/a.webp', loading: 'eager', placeholder })
        await loadAndDecode(img)
        expect(out).toEqual([])
        vi.advanceTimersByTime(400)
        expect(box.style.backgroundColor).toBe('')
      }
    }
  })

  it('keeps a placeholder from author CSS under the image, and does not animate it', async () => {
    const { img, box, attach } = setup()
    box.removeAttribute('style')
    box.className = 'frame'
    mockAnimate(img)
    const out = mockAnimate(box)
    attach({ url: '/logo.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(out).toEqual([])
  })

  it('leaves a background from author CSS under a transparent placeholder alone', async () => {
    const { img, box, attach } = setup({ thumbhash: alphaHash })
    box.removeAttribute('style')
    box.className = 'frame'
    mockAnimate(img)
    const out = mockAnimate(box)
    attach({ url: '/logo.webp', loading: 'eager', placeholder: 'thumbhash:AAAA' })
    await loadAndDecode(img)
    // The CSS color is not animated away, so it does not jump back when the fade ends.
    expect(out[0]!.keyframes).toEqual({ backgroundImage: `url(${INERT})` })
    vi.advanceTimersByTime(400)
    expect(box.getAttribute('style') ?? '').not.toContain('background-color')
  })

  it('fades a transparent placeholder out earlier with a reveal, before the image has sharpened', async () => {
    const { img, box, attach } = setup({ reveal: focusReveal, fadeDuration: 1000, thumbhash: alphaHash })
    mockAnimate(img)
    const out = mockAnimate(box)
    attach({ url: '/logo.webp', loading: 'eager', placeholder: 'thumbhash:AAAA' })
    await loadAndDecode(img)
    expect(out[0]!.duration).toEqual({ duration: 350, delay: 250, fill: 'forwards' })
  })

  it('fades a transparent placeholder out in the plain window when the reveal throws', async () => {
    const reveal = () => {
      throw new Error('broken reveal')
    }
    const { img, box, attach } = setup({ reveal, fadeDuration: 1000, thumbhash: alphaHash })
    mockAnimate(img)
    const out = mockAnimate(box)
    attach({ url: '/logo.webp', loading: 'eager', placeholder: 'thumbhash:AAAA' })
    load(img)
    await expect(flush()).rejects.toThrow('broken reveal')
    expect(out[0]!.duration).toEqual({ duration: 400, delay: 400, fill: 'forwards' })
  })

  it('cancels the placeholder fade-out when update or destroy cuts the fade short', async () => {
    for (const cut of ['update', 'destroy'] as const) {
      const { img, box, attach } = setup({ thumbhash: alphaHash })
      mockAnimate(img)
      const out = mockAnimate(box)
      const handle = attach({ url: '/logo.webp', loading: 'eager', placeholder: 'thumbhash:AAAA' })
      await loadAndDecode(img)
      vi.advanceTimersByTime(200)
      expect(out[0]!.cancelled).toBe(false)
      if (cut === 'update') handle.update({ url: '/b.webp', placeholder: 'blue' })
      else handle.destroy()
      expect(out[0]!.cancelled).toBe(true)
      expect(box.style.backgroundImage).toBe('')
      if (cut === 'update') expect(box.style.backgroundColor).toBe('blue')
      handle.destroy()
    }
  })

  it('does not fade the placeholder when it swaps directly', async () => {
    media.reducedMotion = true
    const { img, box, attach } = setup()
    const out = mockAnimate(box)
    attach({ url: '/a.webp', loading: 'eager', transparent: true })
    await loadAndDecode(img)
    expect(out).toEqual([])
  })

  it('reads no style or layout through load, decode and reveal', async () => {
    const reads = recordLayoutReads()
    const run = async (options: AttachOptions, hang = false) => {
      const { img, box, attach, fake } = setup()
      mockAnimate(img)
      // A decode that never settles: the timeout reveals the image.
      if (hang) fake.decodeWith = 'hang'
      const handle = attach(options)
      intersect(box)
      resize(box, 320, 213)
      await loadAndDecode(img)
      vi.advanceTimersByTime(250)
      await flush()
      expect(handle.state, JSON.stringify(options)).toBe('loaded')
      vi.advanceTimersByTime(400)
      // Adoption of the displayed image.
      handle.destroy()
      expect(attach(options).state).toBe('loaded')
    }
    await run({ url: '/a.webp' })
    await run({ srcset: '/a-640.webp 640w, /a-1280.webp 1280w', sizes: '50vw', url: '/a-640.webp', loading: 'eager' })
    await run({ src: '/a.jpg', aspectRatio: 1.5 })
    await run({ src: '/a.jpg', fill: true, focalPoint: { x: 20, y: 70 } })
    await run({ src: '/a.jpg' }, true)
    media.reducedMotion = true
    await run({ url: '/a.webp' })
    expect(reads).toEqual([])
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

  it('starts a new generation when a destroyed image is attached again with another source', async () => {
    const { le, img, box, attach } = setup()
    const first = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img, '/a.webp')
    await vi.advanceTimersByTimeAsync(400)
    first.destroy()
    const states: LoadState[] = []
    const displays: (Event | undefined)[] = []
    const next = le.attach(img, {
      url: '/b.webp',
      placeholder: 'blue',
      onStateChange: (state) => states.push(state),
      onDisplay: (_, event) => displays.push(event),
    })
    // The old image is neither adopted nor shown under the new placeholder.
    expect(next.state).toBe('idle')
    expect(displays).toEqual([])
    expect(img.getAttribute('src')).toBe(INERT)
    expect(box.style.backgroundColor).toBe('blue')
    intersect(box)
    expect(img.getAttribute('src')).toBe('/b.webp')
    expect(img.style.opacity).toBe('0')
    await loadAndDecode(img, '/b.webp')
    expect(states).toEqual(['idle', 'loading', 'loaded'])
    expect(displays).toEqual([expect.any(Event)])
  })

  it('resets the picture sources of an earlier source on a new attach', () => {
    document.body.innerHTML = `<span data-le><picture>
      <source media="(min-width:800px)" data-le-sizes="100vw" data-le-srcset="/wide-1440.webp 1440w">
      <img alt="Cliffs" src="${INERT}"></picture></span>`
    const box = document.querySelector('span')!
    const img = document.querySelector('img')!
    const source = document.querySelector('source')!
    fakeImage(img)
    const le = createLazyEase()
    le.attach(img, { srcset: '/sq-750.webp 750w', sizes: '100vw', loading: 'eager' }).destroy()
    expect(source.getAttribute('srcset')).toBe('/wide-1440.webp 1440w')
    // The framework renders new deferred values for the source alone, then attaches again.
    source.setAttribute('data-le-srcset', '/wide2-1440.webp 1440w')
    const next = le.attach(img, { srcset: '/sq-750.webp 750w', sizes: '100vw' })
    expect(next.state).toBe('idle')
    expect(source.hasAttribute('srcset')).toBe(false)
    expect(source.hasAttribute('sizes')).toBe(false)
    expect(img.getAttribute('src')).toBe(INERT)
    expect(img.hasAttribute('srcset')).toBe(false)
    intersect(box)
    expect(source.getAttribute('srcset')).toBe('/wide2-1440.webp 1440w')
    expect(img.getAttribute('srcset')).toBe('/sq-750.webp 750w')
  })

  it('adopts the same source again after destroy, also for a measured image', async () => {
    const { le, img, box, attach } = setup()
    const first = attach({ src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 100, 100)
    const url = img.getAttribute('src')!
    await loadAndDecode(img, url)
    first.destroy()
    const next = le.attach(img, { src: '/a.jpg', aspectRatio: 1 })
    expect(next.state).toBe('loaded')
    expect(img.getAttribute('src')).toBe(url)
    next.destroy()
    // A new revision is another source.
    expect(le.attach(img, { src: '/a.jpg', aspectRatio: 1, version: '2' }).state).toBe('idle')
    expect(img.getAttribute('src')).toBe(INERT)
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

  it('cancels the fade animation of a generation that ends mid-fade; its timer cannot release the next', async () => {
    const { img, box, attach } = setup()
    const animations = mockAnimate(img)
    const handle = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect(animations).toHaveLength(1)
    vi.advanceTimersByTime(200)
    handle.update({ url: '/b.webp', loading: 'eager' })
    expect(animations[0]!.cancelled).toBe(true)
    // The new source is hidden over its placeholder, and the old fade's end does not change that.
    vi.advanceTimersByTime(400)
    expect(img.style.opacity).toBe('0')
    expect(box.style.backgroundColor).toBe(PLACEHOLDER)
    await loadAndDecode(img)
    expect(animations).toHaveLength(2)
    expect(animations[1]!.cancelled).toBe(false)
    handle.destroy()
    expect(animations[1]!.cancelled).toBe(true)
    expect(img.style.opacity).toBe('')
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

  const svg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/%3E'

  it('adopts a data: URI target it installed when the same source is attached again', async () => {
    const { le, img, attach } = setup()
    const first = attach({ url: svg, loading: 'eager' })
    await loadAndDecode(img, svg)
    await vi.advanceTimersByTimeAsync(400)
    first.destroy()
    // A Strict Mode remount, or a new root, after the load.
    const next = le.attach(img, { url: svg, loading: 'eager' })
    expect(next.state).toBe('loaded')
    expect(img.getAttribute('src')).toBe(svg)
    expect(img.style.opacity).toBe('')
  })

  it('resets a data: URI target it installed when another source is attached', async () => {
    const { le, img, box, attach } = setup()
    const first = attach({ url: svg, loading: 'eager' })
    await loadAndDecode(img, svg)
    await vi.advanceTimersByTimeAsync(400)
    first.destroy()
    const next = le.attach(img, { url: '/b.webp', placeholder: 'blue' })
    // The old image is not shown over the new placeholder.
    expect(next.state).toBe('idle')
    expect(img.getAttribute('src')).toBe(INERT)
    expect(box.style.backgroundColor).toBe('blue')
    intersect(box)
    expect(img.getAttribute('src')).toBe('/b.webp')
    await loadAndDecode(img, '/b.webp')
    expect(next.state).toBe('loaded')
  })

  const lqip = 'data:image/png;base64,iVBORw0KGgo='

  it('treats a data: placeholder the app wrote back after destroy as the placeholder of the same source', async () => {
    const { le, img, attach } = setup()
    const first = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img, '/a.webp')
    await vi.advanceTimersByTimeAsync(400)
    first.destroy()
    // The app puts its placeholder back, and the browser loads it.
    img.setAttribute('src', lqip)
    load(img, lqip)
    const displays: (Event | undefined)[] = []
    const next = le.attach(img, { url: '/a.webp', loading: 'eager', onDisplay: (_, event) => displays.push(event) })
    expect(next.state).toBe('loading')
    expect(displays).toEqual([])
    expect(img.getAttribute('src')).toBe('/a.webp')
    expect(img.style.opacity).toBe('0')
    await loadAndDecode(img, '/a.webp')
    expect(next.state).toBe('loaded')
    expect(displays).toEqual([expect.any(Event)])
  })

  it('keeps a data: placeholder the app wrote back after destroy when another source is attached', async () => {
    const { le, img, box, attach } = setup()
    const first = attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img, '/a.webp')
    await vi.advanceTimersByTimeAsync(400)
    first.destroy()
    img.setAttribute('src', lqip)
    load(img, lqip)
    const next = le.attach(img, { url: '/b.webp' })
    expect(next.state).toBe('idle')
    expect(img.getAttribute('src')).toBe(lqip)
    intersect(box)
    expect(img.getAttribute('src')).toBe('/b.webp')
    // A source change resets to the app's placeholder, not the inert pixel.
    next.update({ url: '/c.webp' })
    expect(img.getAttribute('src')).toBe(lqip)
  })

  const prepared = (name: string): AttachOptions => ({ srcset: `/${name}-640.webp 640w`, sizes: '100vw' })

  for (const placeholder of [lqip, INERT]) {
    it(`treats a data: placeholder written back after destroy as the placeholder of the same srcset-only source (${placeholder.slice(0, 14)})`, async () => {
      const { le, img, attach } = setup()
      img.setAttribute('src', placeholder)
      const first = attach({ ...prepared('a'), loading: 'eager' })
      await loadAndDecode(img)
      await vi.advanceTimersByTimeAsync(400)
      first.destroy()
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      img.setAttribute('src', placeholder)
      load(img, placeholder)
      const displays: (Event | undefined)[] = []
      const next = le.attach(img, { ...prepared('a'), loading: 'eager', onDisplay: (_, event) => displays.push(event) })
      expect(next.state).toBe('loading')
      expect(displays).toEqual([])
      expect(img.style.opacity).toBe('0')
      await loadAndDecode(img)
      expect(next.state).toBe('loaded')
      expect(displays).toEqual([expect.any(Event)])
    })
  }

  it('keeps the data: placeholder under a srcset-only target when another source is attached', async () => {
    const { le, img, attach } = setup()
    img.setAttribute('src', lqip)
    const first = attach({ ...prepared('a'), loading: 'eager' })
    await loadAndDecode(img)
    await vi.advanceTimersByTimeAsync(400)
    first.destroy()
    const next = le.attach(img, prepared('b'))
    expect(next.state).toBe('idle')
    expect(img.getAttribute('src')).toBe(lqip)
    expect(img.hasAttribute('srcset')).toBe(false)
  })

  for (const boxedImage of [true, false]) {
    for (const [kind, options] of [
      ['url', { url: '/a.webp', loading: 'eager' }],
      ['measured', { src: '/a.jpg', aspectRatio: 1, loading: 'eager' }],
    ] as [string, AttachOptions][]) {
      it(`goes back to the data: placeholder for another source after destroy, as update does (${boxedImage ? 'boxed' : 'boxless'}, ${kind})`, async () => {
        const result = async (change: 'update' | 'destroy') => {
          document.body.innerHTML = boxedImage
            ? `<span data-le style="display:block"><img alt="Fern" src="${lqip}"></span>`
            : `<img data-le alt="Fern" src="${lqip}">`
          const img = document.querySelector('img')!
          fakeImage(img)
          const le = createLazyEase({ loader: webpLoader })
          const first = le.attach(img, options)
          resize(img.closest('[data-le]')!, 100, 100)
          expect(img.getAttribute('src')).not.toBe(lqip)
          await loadAndDecode(img)
          await vi.advanceTimersByTimeAsync(400)
          let next: Attachment
          if (change === 'update') (next = first).update({ url: '/b.webp' })
          else {
            first.destroy()
            next = le.attach(img, { url: '/b.webp' })
          }
          return { state: next.state, src: img.getAttribute('src'), srcset: img.getAttribute('srcset') }
        }
        const destroyed = await result('destroy')
        expect(destroyed).toEqual({ state: 'idle', src: lqip, srcset: null })
        expect(destroyed).toEqual(await result('update'))
      })
    }
  }
})

describe('focus reveal', () => {
  it('sharpens from 8 % of the longer edge while it fades in, and reads no layout', async () => {
    const { img, box, attach } = setup({ reveal: focusReveal })
    const animations = mockAnimate(img)
    const reads = recordLayoutReads()
    attach({ url: '/a.webp' })
    resize(box, 320, 213)
    intersect(box)
    expect(img.style.opacity).toBe('0')
    await loadAndDecode(img)
    expect(animations).toMatchObject([
      {
        keyframes: [
          { opacity: 0, filter: 'blur(25.6px)', mask: 'linear-gradient(#000,#000)', webkitMask: 'linear-gradient(#000,#000)', easing: 'ease-out' },
          { opacity: 1, offset: 0.45 },
          { opacity: 1, filter: 'blur(0px)', mask: 'linear-gradient(#000,#000)', webkitMask: 'linear-gradient(#000,#000)' },
        ],
        duration: 400,
        cancelled: false,
      },
    ])
    expect(box.style.backgroundColor).toBe(PLACEHOLDER)
    vi.advanceTimersByTime(400)
    // Released like a fade: the animation and its blur end, the placeholder goes.
    expect(animations[0]!.cancelled).toBe(true)
    expect(box.style.backgroundColor).toBe('')
    expect(img.style.opacity).toBe('')
    expect(img.style.filter).toBe('')
    expect(reads).toEqual([])
  })

  it('takes reveal per image, and keeps the plain fade by default', async () => {
    const plain = setup()
    const plainAnimations = mockAnimate(plain.img)
    plain.attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(plain.img)
    expect(plainAnimations[0]!.keyframes).toEqual({ opacity: [0, 1], easing: 'ease-out' })

    const focused = setup()
    const animations = mockAnimate(focused.img)
    focused.attach({ url: '/a.webp', loading: 'eager', reveal: focusReveal })
    resize(focused.box, 200, 400)
    await loadAndDecode(focused.img)
    expect((animations[0]!.keyframes as Keyframe[])[0]!.filter).toBe('blur(32px)')
  })

  it('runs any reveal with the longer edge, a ResizeObserver reported', async () => {
    const edges: number[] = []
    const reveal = (edge: number) => (edges.push(edge), [{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1, transform: 'none' }])
    const { img, box, attach } = setup({ reveal })
    const animations = mockAnimate(img)
    attach({ url: '/a.webp' })
    resize(box, 300, 500)
    intersect(box)
    await loadAndDecode(img)
    expect(edges).toEqual([500])
    expect(animations[0]!.keyframes).toEqual([{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1, transform: 'none' }])
  })

  it('starts from a fixed blur when no size was reported', async () => {
    const { img, attach } = setup({ reveal: focusReveal })
    const animations = mockAnimate(img)
    attach({ url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img)
    expect((animations[0]!.keyframes as Keyframe[])[0]!.filter).toBe('blur(24px)')
  })

  it('swaps directly with reduced motion or a zero fade', async () => {
    for (const config of [{ fadeDuration: 0 }, {}]) {
      media.reducedMotion = !('fadeDuration' in config)
      const { img, box, attach } = setup({ reveal: focusReveal, ...config })
      const animations = mockAnimate(img)
      attach({ url: '/a.webp', loading: 'eager' })
      resize(box, 320, 213)
      await loadAndDecode(img)
      expect(animations).toEqual([])
      expect(img.style.opacity).toBe('')
      expect(box.style.backgroundColor).toBe('')
    }
  })

  it('falls back to the plain fade when a reveal throws, and reports the error', async () => {
    const { img, box, attach } = setup({
      reveal: () => {
        throw new Error('broken reveal')
      },
    })
    const animations = mockAnimate(img)
    attach({ url: '/a.webp', loading: 'eager' })
    load(img)
    // Reported from a timer of its own, after the display.
    await expect(flush()).rejects.toThrow('broken reveal')
    // The fade it has without a reveal, animation and transition.
    expect(animations).toMatchObject([{ keyframes: { opacity: [0, 1], easing: 'ease-out' }, duration: 400 }])
    expect(img.style.opacity).toBe('1')
    expect(img.style.transition).toBe('opacity 400ms ease-out')
    vi.advanceTimersByTime(400)
    expect(img.style.opacity).toBe('')
    expect(box.style.backgroundColor).toBe('')
  })

  it('observes the box only when a fade can run', () => {
    const observed = (box: Element) => MockResizeObserver.instances.some((o) => o.elements.has(box))
    for (const [config, options, expected, reduced] of [
      [{}, {}, true],
      [{ fadeDuration: 0 }, {}, false],
      [{}, { priority: true }, false],
      [{}, {}, false, true],
    ] as [LazyEaseConfig, AttachOptions, boolean, boolean?][]) {
      resetObservers()
      media.reducedMotion = !!reduced
      const { box, attach } = setup({ reveal: focusReveal, ...config })
      attach(options.priority ? options : { url: '/a.webp', ...options })
      expect(observed(box)).toBe(expected)
    }
    // A bare img has no fade.
    resetObservers()
    document.body.innerHTML = `<img alt="" src="${INERT}">`
    const img = document.querySelector('img')!
    createLazyEase({ reveal: focusReveal }).attach(img, { url: '/a.webp' })
    expect(observed(img)).toBe(false)
  })

  it('stops watching the box edge after the first display, and never watches it for an adopted image', async () => {
    const observed = (box: Element) => MockResizeObserver.instances.some((o) => o.elements.has(box))
    const { img, box, attach } = setup({ reveal: focusReveal })
    attach({ url: '/a.webp', loading: 'eager' })
    expect(observed(box)).toBe(true)
    await loadAndDecode(img)
    expect(observed(box)).toBe(false)

    // Measured images keep their own subscription for candidate upgrades.
    resetObservers()
    const measured = setup({ reveal: focusReveal })
    measured.attach({ src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(measured.box, 100, 100)
    await loadAndDecode(measured.img)
    expect(MockResizeObserver.instances.flatMap((o) => [...o.elements]).filter((element) => element === measured.box)).toHaveLength(1)

    // Already displayed when attached: nothing to reveal, nothing to watch.
    resetObservers()
    const adopted = setup({ reveal: focusReveal }, 'srcset="/a.webp 640w" sizes="640px"')
    Object.assign(adopted.img, { complete: true, naturalWidth: 100 })
    adopted.attach({ srcset: '/a.webp 640w', sizes: '640px' })
    expect(adopted.states).toEqual(['loaded'])
    expect(observed(adopted.box)).toBe(false)

    // Already failed when attached: the error is final, nothing to watch either.
    resetObservers()
    const failed = setup({ reveal: focusReveal })
    failed.img.setAttribute('src', '/missing.webp')
    Object.assign(failed.img, { complete: true, naturalWidth: 0 })
    failed.attach({ url: '/missing.webp' })
    expect(failed.states).toEqual(['error'])
    expect(observed(failed.box)).toBe(false)

    // A load error ends the watch too: the error is final.
    resetObservers()
    const broken = setup({ reveal: focusReveal })
    broken.attach({ url: 'data:image/png;base64,AA==', loading: 'eager' })
    expect(observed(broken.box)).toBe(true)
    fail(broken.img)
    expect(broken.states.at(-1)).toBe('error')
    expect(observed(broken.box)).toBe(false)
  })

  it('stops observing the box when the generation ends', async () => {
    const { box, attach } = setup({ reveal: focusReveal })
    const handle = attach({ url: '/a.webp' })
    expect(MockResizeObserver.instances.some((o) => o.elements.has(box))).toBe(true)
    handle.destroy()
    expect(MockResizeObserver.instances.some((o) => o.elements.has(box))).toBe(false)
  })
})

describe('callbacks that start the next generation', () => {
  const next: AttachOptions = { url: '/b.webp', loading: 'eager', placeholder: 'red' }

  /** B is still loading long after A's fade would have ended: it keeps its placeholder and stays hidden. */
  async function expectPending(img: HTMLImageElement, box: HTMLElement, handle: Attachment) {
    expect(img.getAttribute('src')).toBe('/b.webp')
    vi.advanceTimersByTime(1000)
    expect(box.style.backgroundColor).toBe('red')
    expect(img.style.opacity).toBe('0')
    expect(handle.state).toBe('loading')
  }

  it('leaves the next placeholder alone when a reveal updates the image', async () => {
    const { img, box, attach } = setup()
    const animations = mockAnimate(img)
    const handle: Attachment = attach({
      url: '/a.webp',
      loading: 'eager',
      reveal: (edge) => (handle.update(next), focusReveal(edge)),
    })
    await loadAndDecode(img)
    expect(animations).toEqual([])
    await expectPending(img, box, handle)
  })

  it('leaves the next placeholder alone when onStateChange updates the image on display or error', async () => {
    for (const settle of [loadAndDecode, async (img: HTMLImageElement) => fail(img)]) {
      let handle: Attachment | undefined
      let once = true
      const { img, box, attach } = setup({
        onStateChange: (state) => {
          if ((state === 'loaded' || state === 'error') && once) {
            once = false
            handle!.update(next)
          }
        },
      })
      const animations = mockAnimate(img)
      handle = attach({ url: '/a.webp', loading: 'eager' })
      await settle(img)
      expect(animations).toEqual([])
      await expectPending(img, box, handle)
    }
  })

  it('writes nothing when onStateChange updates the image as it starts loading', () => {
    let handle: Attachment | undefined
    let once = true
    const { img, box, attach } = setup({
      onStateChange: (state) => {
        if (state === 'loading' && once) {
          once = false
          handle!.update(next)
        }
      },
    })
    handle = attach({ url: '/a.webp' })
    intersect(box)
    expect(img.getAttribute('src')).toBe('/b.webp')
    expect(box.style.backgroundColor).toBe('red')
  })

  it('ends the new generation when onStateChange destroys it as it starts, and leaves the image to the next attachment', async () => {
    for (const create of [createLazyEase, createPrepared]) {
      const { img, box } = boxed()
      let handle: Attachment | undefined
      let armed = false
      const le = create({
        onStateChange: (state) => {
          if (state !== 'idle' || !armed) return
          armed = false
          handle!.destroy()
          le.attach(img, { url: '/c.webp', loading: 'eager' })
        },
      })
      handle = le.attach(img, { url: '/a.webp', loading: 'eager' })
      expect(img.getAttribute('src')).toBe('/a.webp')
      armed = true
      handle.update({ url: '/b.webp' })
      intersect(box)
      await flush()
      expect(img.getAttribute('src')).toBe('/c.webp')
      expect(box.getAttribute('data-state')).toBe('loading')
    }
  })
})

// The real setTimeout, from before the fake timers: Node reports an unhandled rejection only after a macrotask.
const macrotask = setTimeout.bind(globalThis)
interface Rejections {
  listeners(event: string): ((...args: unknown[]) => void)[]
  removeAllListeners(event: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

/** Collects what a callback throws outside a call of the test: from an event listener (jsdom reports it) or a promise. */
function uncaught() {
  const errors: unknown[] = []
  const node = (globalThis as unknown as { process: Rejections }).process
  const saved = node.listeners('unhandledRejection')
  node.removeAllListeners('unhandledRejection')
  node.on('unhandledRejection', (reason) => errors.push(reason))
  const onError = (event: ErrorEvent) => {
    errors.push(event.error)
    event.preventDefault()
  }
  window.addEventListener('error', onError)
  return {
    errors,
    /** Lets Node report the rejections so far. */
    settle: () => new Promise((resolve) => macrotask(resolve, 0)),
    restore() {
      window.removeEventListener('error', onError)
      node.removeAllListeners('unhandledRejection')
      for (const listener of saved) node.on('unhandledRejection', listener)
    },
  }
}

describe('an onStateChange that throws', () => {
  const watched = (box: HTMLElement) => MockResizeObserver.instances.some((observer) => observer.elements.has(box))
  const rows: { state: LoadState; options: AttachOptions; drive: (img: HTMLImageElement, box: HTMLElement) => unknown; check: (img: HTMLImageElement, box: HTMLElement, displays: unknown[]) => unknown }[] = [
    {
      // The hidden image still gets its target and shows when it loads.
      state: 'loading',
      options: { url: '/a.webp' },
      drive: (_, box) => intersect(box),
      check: async (img, box, displays) => {
        expect(img.getAttribute('src')).toBe('/a.webp')
        expect(img.style.opacity).toBe('0')
        expect(box.getAttribute('data-state')).toBe('loading')
        await loadAndDecode(img)
        expect(img.style.opacity).toBe('1')
        expect(displays).toHaveLength(1)
        vi.advanceTimersByTime(1000)
        expect(box.style.backgroundColor).toBe('')
      },
    },
    {
      // Shown at once, without onDisplay.
      state: 'loaded',
      options: { url: '/a.webp', loading: 'eager' },
      drive: (img) => loadAndDecode(img),
      check: (img, box, displays) => {
        expect(img.style.opacity).toBe('')
        expect(box.style.backgroundColor).toBe('')
        expect(box.getAttribute('data-state')).toBe('loaded')
        expect(displays).toHaveLength(0)
      },
    },
    {
      // The alt text in the reserved area, as without the throw.
      state: 'error',
      options: { url: 'data:image/png;base64,AA==', loading: 'eager' },
      drive: (img) => fail(img),
      check: (img, box) => {
        expect(img.style.opacity).toBe('')
        expect(box.style.backgroundColor).toBe('')
        expect(box.getAttribute('data-state')).toBe('error')
      },
    },
  ]
  for (const [name, create] of [['full', createLazyEase], ['prepared', createPrepared]] as const)
    for (const row of rows)
      it(`${name}: leaves the image consistent when it throws on ${row.state}, and its error goes on`, async () => {
        const { img, box } = boxed()
        mockAnimate(img)
        const displays: unknown[] = []
        const caught = uncaught()
        try {
          const le = create({
            reveal: focusReveal,
            onStateChange: (state) => {
              if (state === row.state) throw new Error(`broken ${state}`)
            },
          })
          le.attach(img, { ...row.options, onDisplay: (_, event) => displays.push(event) })
          resize(box, 180, 120)
          try {
            await row.drive(img, box)
          } catch (error) {
            caught.errors.push(error)
          }
          await vi.advanceTimersByTimeAsync(0)
          await caught.settle()
          expect(caught.errors).toContainEqual(new Error(`broken ${row.state}`))
          await row.check(img, box, displays)
          // The reveal's edge is watched until the first display or error only.
          expect(watched(box)).toBe(false)
        } finally {
          caught.restore()
        }
      })
})

describe('a callback of a generation leaves its successor alone', () => {
  // An update starts generation B with the options of a row. Once, a callback of B starts the successor N: it
  // updates the image, destroys it and attaches it again, or updates it and throws. Afterwards only N has written.
  const N: AttachOptions = { url: '/n.webp', loading: 'eager', placeholder: 'red' }
  const actions = ['update', 'destroy and attach', 'update and throw'] as const
  type Fire = () => void
  interface Row {
    hook: string
    /** Needs measured mode. */
    measured?: boolean
    /** The callback may throw: its error reaches the test, a listener's or a promise's as uncaught. */
    throws?: boolean
    skip?: (typeof actions)[number]
    /** Generation A, before B. Its state must differ from B's first, or B reports nothing. Default: deferred. */
    a?: AttachOptions
    /** The element, if not a boxed img. */
    markup?: string
    /** `handle` is the current attachment, for a row that chains generations. */
    config?: (fire: Fire, handle: () => Attachment) => LazyEaseConfig
    options: (fire: Fire) => AttachOptions
    /** Before the update to B. */
    before?: (img: HTMLImageElement) => void
    drive?: (img: HTMLImageElement, box: HTMLElement) => unknown
    /** Further checks once N has taken over; `out` are the box's animations. */
    after?: (img: HTMLImageElement, out: { cancelled: boolean }[]) => void
  }
  const b = (options: AttachOptions = {}) => () => ({ url: '/b.webp', ...options })
  const eager = b({ loading: 'eager' })
  const native = () => ({ loading: 'native' as const })
  const measured = () => ({ src: '/b.jpg', loading: 'eager' as const })
  const twoFormats = createLoader({ formats: ['webp', 'avif'] })
  const ladder = createLoader({ widths: [100, 200, 400], formats: ['webp'] })
  const settle = (img: HTMLImageElement) => loadAndDecode(img, '/b.webp')
  const adopt = (naturalWidth: number) => (img: HTMLImageElement) => {
    img.setAttribute('src', '/b.webp')
    Object.assign(img, { complete: true, naturalWidth, currentSrc: '/b.webp' })
  }
  const activatedByN = (img: HTMLImageElement) => {
    const source = img.parentElement!.querySelector('source')!
    expect(source.getAttribute('srcset')).toBe('/wide.webp 1440w')
    expect(source.hasAttribute('sizes')).toBe(false)
  }
  const on = (wanted: LoadState) => (fire: Fire) => ({ onStateChange: (state: LoadState) => void (state === wanted && fire()) })
  const rows: Row[] = [
    { hook: 'onStateChange idle', throws: true, a: { url: '/z.webp', loading: 'eager' }, config: on('idle'), options: b() },
    { hook: 'onStateChange loading at start', throws: true, config: on('loading'), options: eager },
    { hook: 'onStateChange loading when visible', throws: true, config: on('loading'), options: b(), drive: (_, box) => intersect(box) },
    { hook: 'onStateChange loaded', throws: true, config: on('loaded'), options: eager, drive: settle },
    { hook: 'onStateChange error', throws: true, config: on('error'), options: eager, drive: fail },
    { hook: 'onStateChange loaded at adoption', throws: true, config: on('loaded'), options: native, before: adopt(100) },
    { hook: 'onStateChange error at adoption', throws: true, config: on('error'), options: native, before: adopt(0) },
    { hook: 'onDisplay', throws: true, options: (fire) => ({ ...eager(), onDisplay: fire }), drive: settle },
    { hook: 'onDisplay at adoption', throws: true, options: (fire) => ({ ...native(), onDisplay: fire }), before: adopt(100) },
    // B started a reveal and the fade-out of its transparent placeholder: both end with it.
    {
      hook: 'onDisplay with a reveal and a transparent placeholder',
      config: () => ({ reveal: focusReveal, thumbhash: () => ({ style: {}, lazy: () => ({ backgroundImage: 'url("data:image/png;base64,AAAA")' }), transparent: true }) }),
      options: (fire) => ({ ...eager(), placeholder: 'thumbhash:AAAA', onDisplay: fire }),
      drive: settle,
      after: (_, out) => {
        expect(out).toHaveLength(1)
        expect(out[0]!.cancelled).toBe(true)
      },
    },
    // B loads, its onStateChange starts a native generation that adopts B's image, and that one's onDisplay fires.
    {
      hook: 'onDisplay of a native generation that a loaded one started',
      config: (fire, handle) => {
        let chained = false
        return { onStateChange: (state) => void (state === 'loaded' && !chained && ((chained = true), handle().update({ loading: 'native', onDisplay: fire }))) }
      },
      options: eager,
      drive: settle,
    },
    // B activates the deferred sources of its picture; N, eager too, activates them once more.
    {
      hook: 'onStateChange loading of a picture',
      throws: true,
      markup: `<span data-le><picture><source media="(min-width:800px)" data-le-srcset="/wide.webp 1440w"><img alt="" src="${INERT}"></picture></span>`,
      config: on('loading'),
      options: eager,
      after: activatedByN,
    },
    {
      hook: 'onStateChange loaded of a picture',
      throws: true,
      markup: `<span data-le><picture><source media="(min-width:800px)" data-le-srcset="/wide.webp 1440w"><img alt="" src="${INERT}"></picture></span>`,
      config: on('loaded'),
      options: eager,
      drive: settle,
      after: activatedByN,
    },
    { hook: 'reveal', throws: true, config: (fire) => ({ reveal: (edge) => (fire(), focusReveal(edge)) }), options: eager, drive: settle },
    // The decoder runs twice. First while update() resolves B, before anything ends: B overtakes an update from it, as any update.
    {
      hook: 'ThumbHash decoder resolving the options',
      throws: true,
      skip: 'update',
      config: (fire) => ({ thumbhash: () => (fire(), { style: { backgroundColor: 'blue' } }) }),
      options: b({ placeholder: 'thumbhash:AAAA' }),
    },
    // Then as B starts, before it has listeners or a cleanup.
    {
      hook: 'ThumbHash decoder starting the generation',
      throws: true,
      config: (fire) => {
        let calls = 0
        return { thumbhash: () => (++calls === 2 && fire(), { style: { backgroundColor: 'blue' } }) }
      },
      options: b({ placeholder: 'thumbhash:AAAA' }),
    },
    {
      hook: 'ThumbHash lazy decode',
      throws: true,
      config: (fire) => ({ thumbhash: () => ({ style: { backgroundColor: 'green' }, lazy: () => (fire(), { backgroundColor: 'blue' }) }) }),
      options: b({ loading: 'eager', placeholder: 'thumbhash:AAAA' }),
    },
    {
      hook: 'loader',
      measured: true,
      throws: true,
      config: (fire) => ({ loader: (request) => (fire(), `/b-${request.width}.webp`), detectFormat: () => 'webp' }),
      // A browser crop, so that B's focus would show as an object-position on the image.
      options: () => ({ ...measured(), aspectRatio: 1, crop: 'browser' as const, srcWidth: 1000, srcHeight: 500, focalPoint: { x: 10, y: 10 } }),
      drive: (_, box) => resize(box, 300, 300),
    },
    (() => {
      // A ladder of three candidates: the first call ends B, so the loader is not asked for the other two.
      let calls = 0
      return {
        hook: 'loader of a candidate list',
        measured: true,
        throws: true,
        config: (fire: Fire) => {
          calls = 0
          return { loader: { ...ladder, url: ({ width }: ImageRequest) => (calls++, fire(), `/b-${width}.webp`) } }
        },
        options: () => ({ ...measured(), srcWidth: 1000, srcHeight: 500 }),
        drive: (_: HTMLImageElement, box: HTMLElement) => resize(box, 300, 150),
        after: () => expect(calls).toBe(1),
      }
    })(),
    { hook: 'detectFormat returns', measured: true, throws: true, config: (fire) => ({ loader: twoFormats, detectFormat: () => (fire(), 'webp') }), options: measured },
    { hook: 'detectFormat resolves', measured: true, throws: true, config: (fire) => ({ loader: twoFormats, detectFormat: async () => (fire(), 'webp' as const) }), options: measured },
    {
      hook: 'detectFormat rejects',
      measured: true,
      throws: true,
      config: (fire) => ({
        loader: twoFormats,
        detectFormat: async () => {
          fire()
          throw new Error('no format')
        },
      }),
      options: measured,
    },
  ]

  for (const [name, create] of [['full', createLazyEase], ['prepared', createPrepared]] as const)
    for (const row of rows)
      for (const action of actions) {
        if ((row.measured && name === 'prepared') || (action === 'update and throw' && !row.throws) || row.skip === action) continue
        it(`${name}: ${row.hook}, ${action}`, async () => {
          if (row.markup) document.body.innerHTML = row.markup
          const { box, img } = row.markup ? { box: document.querySelector<HTMLElement>('[data-le]')!, img: document.querySelector('img')! } : boxed()
          if (row.markup) fakeImage(img)
          mockAnimate(img)
          const out = mockAnimate(box)
          const caught = uncaught()
          onTestFinished(caught.restore)
          const errors = caught.errors
          const step = async (callback: () => unknown) => {
            try {
              await callback()
            } catch (error) {
              errors.push(error)
            }
          }
          let armed = false
          let current: Attachment | undefined
          const fire = () => {
            if (!armed) return
            armed = false
            if (action === 'destroy and attach') {
              current!.destroy()
              // Back to the placeholder first, or N adopts what B displays.
              img.setAttribute('src', INERT)
              current = le.attach(img, N)
            } else {
              current!.update(N)
              if (action === 'update and throw') throw new Error('boom')
            }
          }
          const le = create({ ...row.config?.(fire, () => current!) })
          current = le.attach(img, row.a ?? { url: '/z.webp' })
          row.before?.(img)
          armed = true
          await step(() => current!.update(row.options(fire)))
          await step(() => row.drive?.(img, box))
          await step(() => vi.advanceTimersByTimeAsync(1000))
          await caught.settle()
          expect(armed).toBe(false)
          if (action === 'update and throw') expect(errors).toContainEqual(new Error('boom'))
          expect(img.getAttribute('src')).toBe('/n.webp')
          expect(box.style.backgroundColor).toBe('red')
          expect(box.style.backgroundImage).toBe('')
          expect(img.style.opacity).toBe('0')
          expect(img.style.objectPosition).toBe('')
          expect(box.getAttribute('data-state')).toBe('loading')
          expect(current.state).toBe('loading')
          expect(() => le.attach(img, { url: '/x.webp' })).toThrow('already attached')
          row.after?.(img, out)
        })
      }

  it('stops asking the loader for candidates once a call ended the generation', () => {
    const { box, img } = boxed()
    const asked: number[] = []
    let handle: Attachment | undefined
    const loader = {
      ...ladder,
      url: ({ width }: ImageRequest) => {
        asked.push(width)
        handle!.update({ url: `/n${width}.webp`, loading: 'eager' })
        return `/b-${width}.webp`
      },
    }
    handle = createLazyEase({ loader }).attach(img, { src: '/b.jpg', loading: 'eager', srcWidth: 1000, srcHeight: 500 })
    resize(box, 300, 150)
    expect(asked).toEqual([100])
    expect(img.getAttribute('src')).toBe('/n100.webp')
    expect(img.hasAttribute('srcset')).toBe(false)
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
    const path = '../src/dom/measure.js?copy'
    const copy = (await import(/* @vite-ignore */ path)) as typeof import('../src/dom/measure.js')
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

  it('releases the image when its observer cannot be built', () => {
    // Like a browser, the constructor rejects a margin without units.
    class Strict extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
        if (options.rootMargin === '400') throw new SyntaxError('rootMargin must be specified in pixels or percent')
        super(callback, options)
      }
    }
    vi.stubGlobal('IntersectionObserver', Strict)
    const { img, box, attach } = setup()
    const added = vi.spyOn(img, 'addEventListener')
    const removed = vi.spyOn(img, 'removeEventListener')
    expect(() => attach({ url: '/a.webp', rootMargin: '400', placeholder: '#00f' })).toThrow(SyntaxError)
    expect(box.hasAttribute('data-state')).toBe(false)
    expect(box.style.backgroundColor).toBe(PLACEHOLDER)
    // The generation that could not start ended: every listener it added is gone.
    expect(removed.mock.calls).toEqual(added.mock.calls)
    expect((img as unknown as Record<symbol, unknown>)[Symbol.for('lazy-ease.attachment')]).toBeUndefined()
    // A later valid attach takes it.
    attach({ url: '/a.webp' })
    expect(box.dataset.state).toBe('idle')
    intersect(box)
    expect(img.getAttribute('src')).toBe('/a.webp')
  })

  it('leaves the target of an earlier source in place when a new attach cannot build its observer', async () => {
    class Strict extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
        if (options.rootMargin === 'bogus') throw new SyntaxError('rootMargin must be specified in pixels or percent')
        super(callback, options)
      }
    }
    vi.stubGlobal('IntersectionObserver', Strict)
    document.body.innerHTML = `<span data-le><picture>
      <source media="(min-width:800px)" data-le-sizes="100vw" data-le-srcset="/wide-1440.webp 1440w">
      <img alt="Cliffs" src="${INERT}"></picture></span>`
    const img = document.querySelector('img')!
    const source = document.querySelector('source')!
    fakeImage(img)
    const le = createLazyEase()
    const first = le.attach(img, { url: '/a.webp', loading: 'eager' })
    await loadAndDecode(img, '/a.webp')
    first.destroy()
    expect(() => le.attach(img, { url: '/b.webp', rootMargin: 'bogus' })).toThrow(SyntaxError)
    expect(img.getAttribute('src')).toBe('/a.webp')
    expect(source.getAttribute('srcset')).toBe('/wide-1440.webp 1440w')
    expect(source.getAttribute('sizes')).toBe('100vw')
    // The element still knows its target, so the same source adopts it.
    expect(le.attach(img, { url: '/a.webp' }).state).toBe('loaded')
  })

  it('keeps the displayed image and the handle when an update has a margin the observer refuses', async () => {
    class Strict extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
        if (options.rootMargin === 'invalid') throw new SyntaxError('rootMargin must be specified in pixels or percent')
        super(callback, options)
      }
    }
    vi.stubGlobal('IntersectionObserver', Strict)
    const { img, box, attach, states } = setup()
    const handle = attach({ url: '/old.webp', loading: 'eager' })
    await loadAndDecode(img)
    vi.advanceTimersByTime(400)
    const claim = () => (img as unknown as Record<symbol, unknown>)[Symbol.for('lazy-ease.attachment')]
    const before = { src: img.getAttribute('src'), state: handle.state, claim: claim(), box: box.getAttribute('style') }
    expect(before.state).toBe('loaded')
    expect(() => handle.update({ url: '/new.webp', rootMargin: 'invalid' })).toThrow(SyntaxError)
    expect(before.claim).toBeDefined()
    expect({ src: img.getAttribute('src'), state: handle.state, claim: claim(), box: box.getAttribute('style') }).toEqual(before)
    expect(states.at(-1)).toBe('loaded')
    // The generation still runs: an upgrade load keeps it loaded, and a valid update still works.
    load(img, '/old.webp')
    await flush()
    expect(handle.state).toBe('loaded')
    handle.update({ url: '/new.webp', rootMargin: '10px' })
    expect(img.getAttribute('src')).toBe(INERT)
    intersect(box)
    expect(img.getAttribute('src')).toBe('/new.webp')
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

  it('asks no detector for a single declared format', () => {
    const detectFormat = vi.fn(() => new Promise<ImageFormat>(() => {}))
    const { img, box } = boxed()
    createLazyEase({ loader: createLoader({ formats: ['jpeg'] }), detectFormat }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=jpeg')
    expect(detectFormat).not.toHaveBeenCalled()
  })

  it('passes auto to an auto-negotiating loader without probing', () => {
    const url = vi.fn((r: ImageRequest) => `/cdn${r.src}?w=${r.width}&f=${r.format}`)
    const { img, box, attach } = setup({ loader: { url, widths: [100, 200], qualities: [75], formats: 'auto' } })
    attach({ src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(box, 100, 100)
    expect(probe.created).toBe(0)
    expect(img.getAttribute('src')).toBe('/cdn/a.jpg?w=200&f=auto')
  })

  it('requests the best declared format other than AVIF without a detector, and warns once in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 2; i++) {
      const { img, box } = boxed()
      createLazyEase({ loader: createLoader() }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
      // Synchronous: the first size installs at once.
      resize(box, 100, 100)
      expect(img.getAttribute('src')).toContain('fmt=webp')
    }
    const other = boxed()
    createLazyEase({ loader: createLoader({ formats: ['avif', 'jpeg'] }) }).attach(other.img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(other.box, 100, 100)
    expect(other.img.getAttribute('src')).toContain('fmt=jpeg')
    expect(probe.created).toBe(0)
    // A loader that declares only AVIF gets AVIF, and no warning.
    const single = boxed()
    createLazyEase({ loader: createLoader({ formats: ['avif'] }) }).attach(single.img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(single.box, 100, 100)
    expect(single.img.getAttribute('src')).toContain('fmt=avif')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toMatch(/request webp\. Pass detectFormat: detectAvif/)
  })

  it('probes once on first need and takes the best declared format', async () => {
    const le = createLazyEase({ loader: createLoader(), detectFormat: detectAvif })
    expect(probe.created).toBe(0)
    const { img, box } = boxed()
    le.attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    await flush()
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=avif')
    expect(probe.created).toBe(1)
  })

  it('decides without a probe when AVIF is not declared', () => {
    expect(detectAvif(['webp', 'jpeg'])).toBe('webp')
    expect(detectAvif(['jpeg', 'webp'])).toBe('webp')
    expect(detectAvif(['avif'])).toBe('avif')
    const { img, box } = boxed()
    createLazyEase({ loader: createLoader({ formats: ['webp', 'jpeg'] }), detectFormat: detectAvif }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    // Synchronous: the first size installs at once.
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=webp')
    expect(probe.created).toBe(0)
  })

  it('falls back to WebP, or the next declared format, when detection takes longer than 200 ms', async () => {
    probe.hang = true
    const { img, box } = boxed()
    createLazyEase({ loader: createLoader(), detectFormat: detectAvif }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    await vi.advanceTimersByTimeAsync(200)
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=webp')
    const jpeg = detectAvif(['avif', 'jpeg'])
    await vi.advanceTimersByTimeAsync(200)
    await expect(jpeg).resolves.toBe('jpeg')
  })

  it('takes WebP, or the next declared format, when the browser does not decode AVIF', async () => {
    probe.avif = false
    const { img, box } = boxed()
    createLazyEase({ loader: createLoader(), detectFormat: detectAvif }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    await flush()
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('fmt=webp')
    const other = boxed()
    createLazyEase({ loader: createLoader({ formats: ['avif', 'jpeg'] }), detectFormat: detectAvif }).attach(other.img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    resize(other.box, 100, 100)
    expect(other.img.getAttribute('src')).toContain('fmt=jpeg')
    expect(probe.created).toBe(1)
  })
})

describe('format detectors that fail', () => {
  const broken = [
    () => {
      throw new Error('broken detector')
    },
    () => Promise.reject(new Error('broken detector')),
  ]

  it('reports the error and takes the format no detector would', async () => {
    for (const detectFormat of broken) {
      const { img, box } = boxed()
      createLazyEase({ loader: createLoader(), detectFormat }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
      await expect(flush()).rejects.toThrow('broken detector')
      resize(box, 100, 100)
      expect(img.getAttribute('src')).toContain('fmt=webp')
    }
  })

  it('installs nothing for a generation that ended before the detector rejected', async () => {
    let reject: (error: Error) => void = () => {}
    let calls = 0
    const detectFormat = (): ImageFormat | Promise<ImageFormat> => (calls++ ? 'jpeg' : new Promise((_, no) => (reject = no)))
    const { img, box } = boxed()
    const handle = createLazyEase({ loader: createLoader(), detectFormat }).attach(img, { src: '/a.jpg', aspectRatio: 1, loading: 'eager' })
    handle.update({ src: '/b.jpg', aspectRatio: 1, loading: 'eager' })
    reject(new Error('broken detector'))
    await expect(flush()).rejects.toThrow('broken detector')
    resize(box, 100, 100)
    expect(img.getAttribute('src')).toContain('/b.jpg')
    expect(img.getAttribute('src')).toContain('fmt=jpeg')
  })
})

describe('without measured mode (@lazy-ease/core/prepared)', () => {
  it('loads prepared, native and direct sources as the full controller does', async () => {
    const { img, box } = boxed()
    const handle = createPrepared().attach(img, { srcset: '/sq-750.webp 750w', sizes: '100vw', loading: 'eager' })
    expect(img.getAttribute('srcset')).toBe('/sq-750.webp 750w')
    expect(box.getAttribute('data-state')).toBe('loading')
    await loadAndDecode(img, '/sq-750.webp')
    expect(handle.state).toBe('loaded')
    handle.update({ src: '/logo.svg', loading: 'eager' })
    expect(img.getAttribute('src')).toBe('/logo.svg')
    expect(img.hasAttribute('srcset')).toBe(false)
  })

  it('rejects a source the loader would build, with or without a loader', () => {
    for (const config of [{}, { loader: webpLoader }]) {
      const { img, box } = boxed()
      const before = document.body.innerHTML
      expect(() => createPrepared(config).attach(img, { src: '/a.jpg', loading: 'eager' })).toThrow('[lazy-ease] src needs createLazyEase from @lazy-ease/core')
      expect(document.body.innerHTML).toBe(before)
      expect(box.hasAttribute('data-state')).toBe(false)
    }
    const { img } = boxed()
    const handle = createPrepared({ loader: webpLoader }).attach(img, { url: '/a.webp' })
    expect(() => handle.update({ src: '/a.jpg' })).toThrow(/src needs createLazyEase/)
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

  it('adopts a loaded native data: URI image as its target', () => {
    const uri = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/%3E'
    document.body.innerHTML = `<img data-le alt="Dot" src='${uri}'>`
    const img = document.querySelector('img')!
    fakeImage(img)
    Object.assign(img, { complete: true, naturalWidth: 10, currentSrc: uri })
    const displays: (Event | undefined)[] = []
    const handle = createLazyEase().attach(img, { loading: 'native', onDisplay: (_, event) => displays.push(event) })
    expect(handle.state).toBe('loaded')
    expect(displays).toEqual([undefined])
  })

  it('reports the load of a native data: URI image', () => {
    const uri = 'data:image/png;base64,AAAA'
    document.body.innerHTML = `<img data-le alt="Dot" src="${uri}">`
    const img = document.querySelector('img')!
    fakeImage(img)
    const handle = createLazyEase().attach(img, { loading: 'native' })
    expect(handle.state).toBe('loading')
    load(img, uri)
    expect(handle.state).toBe('loaded')
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

  it('paints a transparent ThumbHash without its color, and removes it after the reveal', async () => {
    const png = `data:image/png;base64,${btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 32, 0, 0, 0, 32, 8, 6, 0, 0, 0))}`
    const thumbhash = thumbhashDecoder({ thumbHashToAverageRGBA: () => ({ r: 0.5, g: 0, b: 1, a: 0.3 }), thumbHashToDataURL: () => png })
    // A header with the alpha flag (bit 23) set.
    const hash = btoa(String.fromCharCode(0, 0, 0x80, 0, 0, 0))
    for (const reveal of [undefined, focusReveal]) {
      const { img, box, attach } = setup({ thumbhash, reveal })
      mockAnimate(img)
      attach({ url: '/logo.webp', placeholder: `thumbhash:${hash}` })
      expect(box.style.backgroundColor).toBe('rgba(128, 0, 255, 0.3)')
      intersect(box)
      // The blurred image alone: a color under it would tint the transparent parts.
      expect(box.style.backgroundColor).toBe('')
      expect(box.style.backgroundImage).toContain('data:image/svg+xml')
      expect(decodeURIComponent(box.style.backgroundImage)).not.toContain('feFuncA')
      await loadAndDecode(img)
      vi.advanceTimersByTime(400)
      expect(box.style.backgroundImage).toBe('')
      expect(img.style.opacity).toBe('')
    }
  })
})
