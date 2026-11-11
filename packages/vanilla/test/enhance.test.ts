// @vitest-environment jsdom
import { createLazyEase, createLoader, type LazyEaseConfig } from '@lazy-ease/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFormatDetection } from '../../core/src/dom/format.js'
import { resetObservers } from '../../core/src/dom/observe.js'
import { fakeImage, flush, installDom, intersect, load, MockIntersectionObserver, MockResizeObserver, resize } from '../../core/test/dom-mocks.js'
import { cssText } from '../src/css.js'
import { enhance, readOptions } from '../src/index.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const CLAIM = Symbol.for('lazy-ease.attachment')

let errors: unknown[][]
beforeEach(() => {
  installDom()
  resetFormatDetection()
  resetObservers()
  vi.useFakeTimers()
  document.body.innerHTML = ''
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const webp = createLoader({ formats: ['webp'] })
const instance = (config: LazyEaseConfig = {}) => createLazyEase({ loader: webp, ...config })

/** Like a browser, rejects a margin without units. */
class StrictObserver extends MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    if (options.rootMargin && !/^(-?\d+(px|%)\s*)+$/.test(options.rootMargin)) throw new SyntaxError('rootMargin must be specified in pixels or percent')
    super(callback, options)
  }
}

/** A boxed deferred image as a PHP template renders it. */
const boxed = (attributes: string, id = 'box') => `<span data-le id="${id}"><img alt="Fern" src="${INERT}" ${attributes}></span>`

function html(markup: string) {
  document.body.innerHTML = markup
  for (const img of document.querySelectorAll('img')) fakeImage(img)
}
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const img = (box: string) => $<HTMLImageElement>(`#${box} img`)
const claimed = (element: Element) => !!(element as unknown as Record<symbol, unknown>)[CLAIM]

describe('readOptions', () => {
  it('reads every documented field', () => {
    html(
      `<img data-le-src="/fern.jpg" data-le-srcw="2400" data-le-srch="1600" data-le-ar="1.5" data-le-fill data-le-crop="server" ` +
        `data-le-fx="30" data-le-fy="45" data-le-token="1.k1.WisYCsz8Vtmygcbr01tTuA" data-le-v="r7" data-le-q="80" width="400" height="300">`,
    )
    expect(readOptions($('img'))).toEqual({
      src: '/fern.jpg',
      srcWidth: 2400,
      srcHeight: 1600,
      aspectRatio: 1.5,
      fill: true,
      crop: 'server',
      focalPoint: { x: 30, y: 45 },
      token: '1.k1.WisYCsz8Vtmygcbr01tTuA',
      version: 'r7',
      quality: 80,
    })
  })

  it('reads prepared lists and single URLs, and adopts an image without a source attribute as native', () => {
    html(`<img id="a" data-le-srcset="/a-640.webp 640w" data-le-sizes="50vw" data-le-url="/a-640.webp"><img id="b" data-le-url="/b.jpg"><img id="c" src="/c.jpg">`)
    expect(readOptions($('#a'))).toMatchObject({ srcset: '/a-640.webp 640w', sizes: '50vw', url: '/a-640.webp' })
    expect(readOptions($('#a')).loading).toBeUndefined()
    expect(readOptions($('#b'))).toMatchObject({ url: '/b.jpg' })
    expect(readOptions($('#c')).loading).toBe('native')
  })

  it.each([
    ['data-le-srcw="wide"', '[lazy-ease] data-le-srcw'],
    ['data-le-ar=""', '[lazy-ease] data-le-ar'],
    ['data-le-fx="30"', 'data-le-fx/fy'],
    ['data-le-crop="center"', 'data-le-crop'],
    ['data-le-ar="0"', '[lazy-ease] data-le-ar'],
    ['data-le-srcw="-2400"', '[lazy-ease] data-le-srcw'],
    ['data-le-srch="0"', '[lazy-ease] data-le-srch'],
    ['data-le-q="-1"', '[lazy-ease] data-le-q'],
  ])('rejects %s', (attribute, message) => {
    html(`<img data-le-src="/a.jpg" ${attribute}>`)
    expect(() => readOptions($('img'))).toThrow(message)
  })

  it('takes any finite focal point; core clamps it', () => {
    html('<img data-le-src="/a.jpg" data-le-fx="-10" data-le-fy="0">')
    expect(readOptions($('img')).focalPoint).toEqual({ x: -10, y: 0 })
  })
})

describe('enhance', () => {
  it('copies a prepared list on intersection, with no loader and no measuring', async () => {
    html(boxed('data-le-srcset="/a-640.webp 640w, /a-1280.webp 1280w" data-le-sizes="50vw"'))
    enhance(createLazyEase(), document)
    const box = $('#box')
    expect(box.dataset.state).toBe('idle')
    expect(img('box').getAttribute('src')).toBe(INERT)

    intersect(box)
    expect(img('box').getAttribute('sizes')).toBe('50vw')
    expect(img('box').getAttribute('srcset')).toBe('/a-640.webp 640w, /a-1280.webp 1280w')
    expect(MockResizeObserver.instances).toHaveLength(0)
    load(img('box'))
    await flush()
    expect(box.dataset.state).toBe('loaded')
    expect(errors).toEqual([])
  })

  it('swaps a single data-le-url in', () => {
    html(boxed('data-le-url="/_img/fern.jpg?fmt=webp&amp;q=75&amp;w=640"'))
    enhance(createLazyEase())
    intersect($('#box'))
    expect(img('box').getAttribute('src')).toBe('/_img/fern.jpg?fmt=webp&q=75&w=640')
  })

  it('activates deferred picture sources with the fallback img', () => {
    html(
      `<span data-le id="box"><picture><source media="(min-width:800px)" data-le-srcset="/wide-1440.webp 1440w" data-le-sizes="100vw">` +
        `<img alt="Cliffs" src="${INERT}" data-le-srcset="/square-750.webp 750w" data-le-sizes="100vw"></picture></span>`,
    )
    enhance(createLazyEase())
    intersect($('#box'))
    const source = $('source')
    expect(source.getAttribute('srcset')).toBe('/wide-1440.webp 1440w')
    expect(source.getAttribute('sizes')).toBe('100vw')
    expect(img('box').getAttribute('srcset')).toBe('/square-750.webp 750w')
  })

  it.each([
    ['a native img with deferred sources', `<source media="(min-width:800px)" data-le-srcset="/wide-1440.webp 1440w"><img alt="" src="/square.jpg">`],
    ['a deferred img with native sources', `<source media="(min-width:800px)" srcset="/wide-1440.webp 1440w"><img alt="" src="${INERT}" data-le-url="/square.jpg">`],
  ])('reports %s and leaves the picture untouched', (_, inner) => {
    html(`<span data-le id="box"><picture>${inner}</picture></span>`)
    const before = $('#box').outerHTML
    enhance(instance())
    intersect($('#box'))
    expect(errors).toHaveLength(1)
    expect(String(errors[0]![0])).toContain('mixed picture')
    expect($('#box').outerHTML).toBe(before)
    expect(claimed(img('box'))).toBe(false)
  })

  it('reports an element marked both data-le and data-le-background and leaves it alone', () => {
    html(`<span data-le data-le-background id="box"><img alt="" src="${INERT}" data-le-url="/a.jpg"></span>` + boxed('data-le-url="/b.jpg"', 'ok'))
    enhance(createLazyEase())
    intersect($('#box'))
    expect(errors).toHaveLength(1)
    expect(String(errors[0]![0])).toContain('data-le with data-le-background')
    expect($('#box').hasAttribute('data-state')).toBe(false)
    expect($('#box').hasAttribute('data-le-visible')).toBe(false)
    expect(claimed($('#box')) || claimed(img('box'))).toBe(false)
    expect($('#ok').dataset.state).toBe('idle')
  })

  it('reports an element whose observer cannot be built and still handles the ones after it', () => {
    vi.stubGlobal('IntersectionObserver', StrictObserver)
    html(`<div id="banner" data-le-background></div>` + boxed('data-le-url="/a.jpg"', 'bad') + `<div id="panel"><div id="later" data-le-background></div></div>`)
    enhance(createLazyEase({ rootMargin: '400' }))
    expect(errors.map((error) => error[1])).toEqual([$('#banner'), $('#bad'), $('#later')])
    // A background is left unclaimed, so a later call with a valid margin arms it.
    expect(claimed($('#banner')) || claimed($('#later'))).toBe(false)
    enhance(createLazyEase())
    intersect($('#banner'))
    expect($('#banner').hasAttribute('data-le-visible')).toBe(true)
    // So is the image: no claim, no state and no fade stay behind.
    expect($('#bad').dataset.state).toBe('idle')
    intersect($('#bad'))
    expect(img('bad').getAttribute('src')).toBe('/a.jpg')
  })

  it('leaves an image that could not be observed as it was', () => {
    vi.stubGlobal('IntersectionObserver', StrictObserver)
    html(boxed('data-le-url="/a.jpg"', 'bad'))
    $('#bad').style.backgroundColor = 'red'
    enhance(createLazyEase({ rootMargin: '400' }))
    expect($('#bad').hasAttribute('data-state')).toBe(false)
    expect($('#bad').style.backgroundColor).toBe('red')
    expect(img('bad').style.opacity).toBe('')
    expect(claimed(img('bad'))).toBe(false)
  })

  it('measures a signed source through the configured loader', () => {
    html(boxed('data-le-src="/cliff.jpg" data-le-ar="1" data-le-fx="30" data-le-fy="45" data-le-v="r7" data-le-token="1.k1.WisYCsz8Vtmygcbr01tTuA"'))
    enhance(instance())
    intersect($('#box'))
    resize($('#box'), 300, 300)
    expect(img('box').getAttribute('src')).toBe('/_img/cliff.jpg?ar=1&fmt=webp&fx=30&fy=45&q=75&token=1.k1.WisYCsz8Vtmygcbr01tTuA&v=r7&w=640')
  })

  it('needs a configured loader for a measured source and leaves the image alone without one', () => {
    html(boxed('data-le-src="/fern.jpg"', 'measured') + boxed('data-le-url="/b.jpg"', 'prepared'))
    enhance(createLazyEase())
    expect(errors).toHaveLength(1)
    expect(String(errors[0]![0])).toContain('src needs a loader')
    expect($('#measured').hasAttribute('data-state')).toBe(false)
    expect(claimed(img('measured'))).toBe(false)
    expect($('#prepared').dataset.state).toBe('idle')
  })

  it('reports invalid attributes and still attaches the other images', () => {
    html(boxed('data-le-src="/a.jpg" data-le-url="/a.jpg"', 'both') + boxed('data-le-fx="1" data-le-url="/a.jpg"', 'half') + boxed('data-le-url="/c.jpg"', 'ok'))
    enhance(instance())
    expect(errors).toHaveLength(2)
    expect($('#both').hasAttribute('data-state')).toBe(false)
    expect(img('both').getAttribute('src')).toBe(INERT)
    expect($('#ok').dataset.state).toBe('idle')
  })

  it('adopts native HTML and keeps it visible', () => {
    html(`<span data-le id="box" style="background-color:rgb(1, 2, 3)"><img alt="Dunes" src="/dunes.jpg" srcset="/dunes-640.jpg 640w" sizes="100vw"></span>`)
    enhance(instance())
    const box = $('#box')
    expect(box.dataset.state).toBe('loading')
    load(img('box'))
    expect(box.dataset.state).toBe('loaded')
    expect(img('box').style.opacity).toBe('')
    expect(box.style.backgroundColor).toBe('')
    expect(img('box').getAttribute('srcset')).toBe('/dunes-640.jpg 640w')
  })

  it('includes the root itself, an img marker as well as a box', () => {
    html(boxed('data-le-url="/a.jpg"') + `<img data-le id="bare" src="${INERT}" data-le-url="/b.jpg">`)
    const le = createLazyEase()
    enhance(le, $('#box'))
    expect($('#box').dataset.state).toBe('idle')
    expect($('#bare').hasAttribute('data-state')).toBe(false)
    enhance(le, $('#bare'))
    expect($('#bare').dataset.state).toBe('idle')
  })

  it('leaves an img that belongs to a nested box to that box', () => {
    html(`<span data-le id="outer" style="display:block"><span data-le id="inner"><img alt="" src="${INERT}" data-le-url="/a.jpg"></span></span>`)
    enhance(createLazyEase())
    expect($('#outer').hasAttribute('data-state')).toBe(false)
    expect($('#inner').dataset.state).toBe('idle')
  })

  it('can enhance again: owned images are skipped, and destroy releases only its own', () => {
    html(boxed('data-le-url="/a.jpg"', 'a'))
    const le = createLazyEase()
    const first = enhance(le)
    document.body.insertAdjacentHTML('beforeend', boxed('data-le-url="/b.jpg"', 'b'))
    fakeImage(img('b'))
    const second = enhance(le)
    expect(errors).toEqual([])
    expect(claimed(img('a')) && claimed(img('b'))).toBe(true)

    second.destroy()
    expect(claimed(img('a'))).toBe(true)
    expect(claimed(img('b'))).toBe(false)
    first.destroy()
    expect(claimed(img('a'))).toBe(false)
    // Nothing is observed any more, and the pool is gone.
    expect(MockIntersectionObserver.instances.every((observer) => observer.elements.size === 0)).toBe(true)
    // Destroying twice is harmless, and a later enhance takes the images again.
    first.destroy()
    enhance(le)
    expect(claimed(img('a')) && claimed(img('b'))).toBe(true)
  })

  it('handles nested roots and a second instance or bundle on the same markup', () => {
    html(`<section id="outer">${boxed('data-le-url="/a.jpg"', 'a')}<div id="inner">${boxed('data-le-url="/b.jpg"', 'b')}</div></section>`)
    const outer = enhance(createLazyEase(), $('#outer'))
    const other = createLazyEase()
    const inner = enhance(other, $('#inner'))
    const whole = enhance(other, document)
    expect(errors).toEqual([])
    inner.destroy()
    whole.destroy()
    // The images still belong to the first instance.
    expect(claimed(img('a')) && claimed(img('b'))).toBe(true)
    outer.destroy()
    expect(claimed(img('a')) || claimed(img('b'))).toBe(false)
  })

  it('skips subtrees whose nearest data-le-auto is off', () => {
    html(
      `<div data-le-auto="off">${boxed('data-le-url="/a.jpg"', 'managed')}<div data-le-auto>${boxed('data-le-url="/b.jpg"', 'again')}</div></div>` +
        `<div data-le-auto="off" data-le id="offbox"><img alt="" src="${INERT}" data-le-url="/c.jpg"></div>`,
    )
    enhance(createLazyEase())
    expect($('#managed').hasAttribute('data-state')).toBe(false)
    expect($('#offbox').hasAttribute('data-state')).toBe(false)
    expect($('#again').dataset.state).toBe('idle')
  })

  it('enhances inside a shadow root only when given that root', () => {
    html('<div id="host"></div>')
    const shadow = $('#host').attachShadow({ mode: 'open' })
    shadow.innerHTML = boxed('data-le-url="/a.jpg"')
    fakeImage(shadow.querySelector('img')!)
    const le = createLazyEase()
    enhance(le, document)
    expect(shadow.querySelector('[data-le]')!.hasAttribute('data-state')).toBe(false)
    enhance(le, shadow)
    expect(shadow.querySelector<HTMLElement>('[data-le]')!.dataset.state).toBe('idle')
  })

  it('marks a decorative background visible once, against the instance root and margin', () => {
    html('<div id="panel"><div id="banner" data-le-background aria-hidden="true"></div></div>')
    const panel = $('#panel')
    const le = createLazyEase({ root: panel, rootMargin: '100px' })
    const handle = enhance(le, panel)
    enhance(le, panel)
    const observer = MockIntersectionObserver.instances.at(-1)!
    expect(observer.options.root).toBe(panel)
    expect(observer.options.rootMargin).toBe('100px')
    expect(observer.elements.has($('#banner'))).toBe(true)
    expect($('#banner').hasAttribute('data-le-visible')).toBe(false)

    intersect($('#banner'))
    expect($('#banner').hasAttribute('data-le-visible')).toBe(true)
    expect(claimed($('#banner'))).toBe(false)
    expect(observer.disconnected).toBe(true)
    // Already visible: nothing to arm.
    enhance(le, panel)
    expect(MockIntersectionObserver.instances.at(-1)!.elements.size).toBe(0)
    handle.destroy()
  })

  it('stops watching a background on destroy', () => {
    html('<div id="banner" data-le-background></div>')
    const handle = enhance(createLazyEase({ dwellTime: 200 }))
    handle.destroy()
    intersect($('#banner'))
    vi.advanceTimersByTime(500)
    expect($('#banner').hasAttribute('data-le-visible')).toBe(false)
    expect(claimed($('#banner'))).toBe(false)
  })
})

describe('the self-starting script', () => {
  async function start(dataset: Record<string, string> = {}) {
    vi.resetModules()
    const script = document.createElement('script')
    Object.assign(script.dataset, dataset)
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true })
    try {
      await import('../src/auto.js')
    } finally {
      delete (document as unknown as Record<string, unknown>).currentScript
    }
  }

  it('enhances only opted-in areas, and prepared images need no configuration', async () => {
    html(`<section data-le-auto>${boxed('data-le-url="/a.jpg"', 'in')}</section>${boxed('data-le-url="/b.jpg"', 'out')}`)
    await start()
    expect($('#in').dataset.state).toBe('idle')
    expect($('#out').hasAttribute('data-state')).toBe(false)
  })

  it('configures the reference loader from its script tag', async () => {
    html(`<main data-le-auto>${boxed('data-le-src="/fern.jpg" data-le-ar="1"', 'm')}</main>`)
    await start({ baseUrl: '/media/', formats: 'jpeg', rootMargin: '50px' })
    expect(MockIntersectionObserver.instances.at(-1)!.options.rootMargin).toBe('50px')
    intersect($('#m'))
    resize($('#m'), 100, 100)
    await flush()
    expect(img('m').getAttribute('src')).toBe('/media/fern.jpg?ar=1&fmt=jpeg&q=75&w=256')
  })

  it('reports and ignores an unknown format or an invalid dwell time, and still starts', async () => {
    html(`<main data-le-auto>${boxed('data-le-src="/fern.jpg" data-le-ar="1"', 'm')}${boxed('data-le-url="/a.jpg"', 'p')}</main>`)
    vi.stubGlobal('IntersectionObserver', StrictObserver)
    await start({ baseUrl: '/media/', formats: 'webp gif', rootMargin: '400', dwellTime: '-5' })
    expect(errors.map((error) => String(error[0]))).toEqual([
      'TypeError: [lazy-ease] data-formats ignored',
      'TypeError: [lazy-ease] data-root-margin ignored',
      'TypeError: [lazy-ease] data-dwell-time ignored',
    ])
    // The loader still works with the default formats, the default margin applies, and without a dwell time an image starts at once.
    expect($('#m').dataset.state).toBe('idle')
    expect(MockIntersectionObserver.instances.at(-1)!.options.rootMargin).toBe('400px')
    intersect($('#p'))
    expect(img('p').getAttribute('src')).toBe('/a.jpg')
  })

  it('takes data-root-margin without IntersectionObserver and loads at once', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    html(`<main data-le-auto>${boxed('data-le-url="/a.jpg"', 'm')}</main>`)
    await start({ rootMargin: '50px' })
    expect(errors).toEqual([])
    expect(img('m').getAttribute('src')).toBe('/a.jpg')
  })

  it.each(['soon', '', ' ', '-0', 'Infinity', '1e3'])('ignores data-dwell-time="%s"', async (dwellTime) => {
    html(`<main data-le-auto>${boxed('data-le-url="/a.jpg"', 'm')}</main>`)
    await start({ dwellTime })
    expect(errors).toHaveLength(1)
    expect($('#m').dataset.state).toBe('idle')
  })

  it('reports measured images when no loader is configured', async () => {
    html(`<main data-le-auto>${boxed('data-le-src="/fern.jpg"', 'm')}</main>`)
    await start()
    expect(String(errors[0]?.[0])).toContain('src needs a loader')
  })
})

describe('cssText', () => {
  it('has zero specificity throughout', () => {
    const selectors = cssText.trim().split('}').filter(Boolean).map((rule) => rule.slice(0, rule.indexOf('{')))
    expect(selectors).toHaveLength(4)
    for (const selector of selectors) expect(selector).toMatch(/^:where\(.*\)$/)
  })
})
