import { act, fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { rgbaToThumbHash } from 'thumbhash'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LazyEaseProvider } from '../src/context.js'
import { Image, type ImageProps } from '../src/Image.js'
import { createLoader } from '../src/loader.js'
import { MockIntersectionObserver, MockResizeObserver, advance, defaultRect, detectionImage, intersect } from './dom.js'

function solidThumbHash(r: number, g: number, b: number): string {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, 255], i)
  return btoa(String.fromCharCode(...rgbaToThumbHash(8, 8, rgba)))
}

const RED = `thumbhash:${solidThumbHash(255, 0, 0)}`

const img = (markup: string) => markup.match(/<img[^>]*>/)![0]
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]
const withoutNoscript = (markup: string) => markup.replace(/<noscript>.*?<\/noscript>/g, '')
const widths = (srcset: string) => srcset.split(', ').map((c) => Number(c.split(' ')[1]!.slice(0, -1)))

const html = (props: Partial<ImageProps>) => renderToString(<Image src="/a.jpg" alt="" {...props} />)

/** One case per layout mode and loading path, for the server output and hydration tests. */
const MODES: Record<string, Partial<ImageProps>> = {
  'measured fixed': { width: 320, height: 240 },
  'measured ratio': { aspectRatio: 1.5 },
  'measured fill': { fill: true },
  'measured intrinsic': { width: 300 },
  'measured eager': { width: 320, height: 240, loading: 'eager' },
  external: { src: 'https://other.site/a.jpg', width: 320, height: 240 },
  'classic sizes': { aspectRatio: 1.5, sizes: '50vw' },
  'classic native': { width: 320, height: 240, loading: 'native' },
  'classic priority': { fill: true, aspectRatio: 2, sizes: '100vw', priority: true },
  'classic external priority': { src: 'https://other.site/a.jpg', width: 320, height: 240, priority: true },
  'thumbhash measured': { width: 320, height: 240, placeholder: RED },
  'thumbhash priority': { width: 320, height: 240, placeholder: RED, priority: true },
}

describe('server output', () => {
  it('renders deterministic markup for every mode', () => {
    for (const [name, props] of Object.entries(MODES)) {
      expect(html(props), name).toBe(html(props))
    }
  })

  it('renders measured images without a source or opacity', () => {
    for (const name of ['measured fixed', 'measured ratio', 'measured fill', 'measured intrinsic', 'measured eager', 'external']) {
      const markup = withoutNoscript(html(MODES[name]!))
      expect(markup, name).not.toMatch(/ src(set)?=/i)
      expect(markup, name).not.toContain('opacity')
      expect(markup, name).toContain('data-state="idle"')
    }
  })

  it('renders classic images with src and srcset, visible from the first paint', () => {
    for (const name of ['classic sizes', 'classic native', 'classic priority']) {
      const tag = img(html(MODES[name]!))
      expect(attr(tag, 'src'), name).toMatch(/^\/_img\/a\.jpg\?/)
      expect(attr(tag, 'srcSet'), name).toContain('fmt=webp')
      expect(attr(tag, 'sizes'), name).toBeDefined()
      // Nothing hides it: the default opacity is 1.
      expect(tag, name).not.toContain('opacity')
    }
    expect(attr(img(html(MODES['classic external priority']!)), 'src')).toBe('https://other.site/a.jpg')
  })

  it('emits no <noscript> for classic images', () => {
    for (const name of ['classic sizes', 'classic native', 'classic priority', 'classic external priority']) {
      expect(html(MODES[name]!), name).not.toContain('<noscript>')
    }
  })

  it('emits the <noscript> markup unescaped', () => {
    const markup = html({ width: 320, height: 240 })
    expect(markup).toMatch(/<noscript><img [^>]*srcSet="\/_img\/a\.jpg\?[^"]*"[^>]*\/><\/noscript>/)
    expect(markup).not.toContain('&lt;img')
  })

  it('renders only the average color of a ThumbHash unless opted in', () => {
    const color = html({ fill: true, placeholder: RED })
    expect(color).toMatch(/background-color:#f[ef]000[01]/)
    expect(color).not.toContain('background-image')

    expect(html({ fill: true, sizes: '100vw', placeholder: RED })).not.toContain('background-image')
    expect(html({ fill: true, sizes: '100vw', priority: true, placeholder: RED })).toContain('background-image:url(&quot;data:image/png')
    const opted = renderToString(
      <LazyEaseProvider thumbhashSsr="image">
        <Image src="/a.jpg" alt="" fill placeholder={RED} />
      </LazyEaseProvider>,
    )
    expect(opted).toContain('background-image:url(&quot;data:image/png')
  })
})

describe('classic candidates', () => {
  const srcset = (props: Partial<ImageProps>, provider?: Parameters<typeof LazyEaseProvider>[0]) => {
    const markup = renderToString(
      <LazyEaseProvider {...provider}>
        <Image src="/a.jpg" alt="" {...props} />
      </LazyEaseProvider>,
    )
    return attr(img(markup), 'srcSet')!.replaceAll('&amp;', '&')
  }

  it('offers the full ladder capped at srcWidth with sizes', () => {
    const tag = img(html({ aspectRatio: 1.5, sizes: '(min-width: 800px) 50vw, 100vw', srcWidth: 1300 }))
    expect(widths(attr(tag, 'srcSet')!)).toEqual([64, 128, 256, 384, 640, 750, 828, 1080, 1200])
    expect(attr(tag, 'sizes')).toBe('(min-width: 800px) 50vw, 100vw')
  })

  it('offers snap(w) and snap(2w) with sizes="{w}px" for width without sizes', () => {
    const fixed = img(html({ width: 320, height: 240, loading: 'native' }))
    expect(widths(attr(fixed, 'srcSet')!)).toEqual([384, 640])
    expect(attr(fixed, 'sizes')).toBe('320px')
    const ratio = img(html({ width: 300, aspectRatio: 1.5, priority: true, srcWidth: 500 }))
    expect(widths(attr(ratio, 'srcSet')!)).toEqual([384])
  })

  it('lets sizes win over width', () => {
    const tag = img(html({ width: 320, height: 240, sizes: '50vw' }))
    expect(widths(attr(tag, 'srcSet')!)).toHaveLength(13)
    expect(attr(tag, 'sizes')).toBe('50vw')
    expect(attr(tag, 'width')).toBe('320')
  })

  it('uses the middle candidate as src', () => {
    expect(attr(img(html({ aspectRatio: 1.5, sizes: '100vw' })), 'src')).toContain('w=828')
    expect(attr(img(html({ width: 320, height: 240, loading: 'native' })), 'src')).toContain('w=640')
    // Of two candidates, the upper one.
    expect(attr(img(html({ width: 100, height: 100, loading: 'native' })), 'src')).toContain('w=256')
  })

  it('crops fill images only to aspectRatio', () => {
    expect(srcset({ fill: true, sizes: '100vw' })).not.toContain('ar=')
    expect(srcset({ fill: true, sizes: '100vw', aspectRatio: 16 / 9 })).toContain('ar=1.778&')
    expect(srcset({ width: 320, height: 240, sizes: '50vw' })).toContain('ar=1.333&')
    expect(srcset({ width: 320, sizes: '50vw' })).not.toContain('ar=')
  })

  it('uses WebP, or auto for loaders with formats: auto', () => {
    expect(srcset({ sizes: '100vw' }, { children: null, loader: createLoader({ qualities: [60] }) })).toContain('fmt=webp&q=60')
    expect(srcset({ sizes: '100vw' }, { children: null, loader: { ...createLoader(), formats: 'auto' } })).toContain('fmt=auto')
    expect(srcset({ sizes: '100vw' }, { children: null, loader: { ...createLoader(), formats: ['jpeg'] } })).toContain('fmt=jpeg')
  })
})

describe('priority preload', () => {
  const preloads = (markup: string) => markup.match(/<link rel="preload"[^>]*>/g) ?? []

  it('emits one preload link built from the same strings as the img', () => {
    const markup = html({ fill: true, aspectRatio: 2, sizes: '100vw', priority: true })
    const links = preloads(markup)
    expect(links).toHaveLength(1)
    const tag = img(markup)
    expect(attr(links[0]!, 'imageSrcSet')).toBe(attr(tag, 'srcSet'))
    expect(attr(links[0]!, 'imageSizes')).toBe(attr(tag, 'sizes'))
    expect(attr(links[0]!, 'fetchPriority')).toBe('high')
    expect(attr(links[0]!, 'as')).toBe('image')
    expect(attr(tag, 'fetchPriority')).toBe('high')
    expect(tag).not.toContain('loading=')
  })

  it('preloads with a loader whose URLs contain commas', () => {
    const loader = { ...createLoader(), url: ({ width }: { width: number }) => `/c/w_${width},c_fill/a.jpg` }
    const markup = renderToString(
      <LazyEaseProvider loader={loader}>
        <Image src="/a.jpg" alt="" width={320} height={240} priority />
      </LazyEaseProvider>,
    )
    expect(preloads(markup)).toHaveLength(1)
    expect(attr(preloads(markup)[0]!, 'imageSrcSet')).toBe(attr(img(markup), 'srcSet'))
  })

  it('preloads external priority images by href', () => {
    const links = preloads(html(MODES['classic external priority']!))
    expect(links).toHaveLength(1)
    expect(attr(links[0]!, 'href')).toBe('https://other.site/a.jpg')
  })

  it('emits no preload without priority', () => {
    expect(preloads(html({ width: 320, height: 240, loading: 'native' }))).toHaveLength(0)
  })
})

describe('classic loading', () => {
  const observed = (box: Element) => MockIntersectionObserver.instances.some((o) => o.elements.has(box))
  const resizeObserved = (box: Element) => [...MockResizeObserver.instances].some((o) => o.elements.has(box))

  function mount(props: Partial<ImageProps>) {
    const { container } = render(<Image src="/a.jpg" alt="" {...props} />)
    const box = container.querySelector<HTMLElement>('[data-state]')!
    return { box, img: box.querySelector('img')! }
  }

  it('gives native images loading="lazy" and no observer', async () => {
    defaultRect.top = 0
    const { box, img } = mount({ width: 320, height: 240, loading: 'native' })
    await advance(1000)
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('srcset')).toContain('384w')
    expect(observed(box)).toBe(false)
    expect(resizeObserved(box)).toBe(false)
  })

  it('leaves lazy classic images to the browser with loading="lazy"', async () => {
    const { box, img } = mount({ aspectRatio: 1.5, sizes: '50vw' })
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('srcset')).toContain('3840w')
    expect(observed(box)).toBe(false)
  })

  it('neither observes nor measures eager classic and priority images', async () => {
    for (const props of [
      { aspectRatio: 1.5, sizes: '50vw', loading: 'eager' as const },
      { width: 320, height: 240, priority: true },
    ]) {
      const { box, img } = mount(props)
      await advance(1000)
      expect(img.hasAttribute('loading')).toBe(false)
      expect(observed(box)).toBe(false)
      expect(resizeObserved(box)).toBe(false)
    }
  })

  it('does not detect the format for classic images', async () => {
    mount({ width: 320, height: 240, priority: true })
    await advance(1000)
    expect(detectionImage.created).toBe(0)
  })

  it('fires onLoad without waiting for decode or fading', async () => {
    const onLoad = vi.fn()
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode')
    const { box, img } = mount({ width: 320, height: 240, priority: true, onLoad })
    expect(box.dataset.state).toBe('loading')
    fireEvent.load(img)
    expect(box.dataset.state).toBe('loaded')
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(decode).not.toHaveBeenCalled()
    expect(img.style.opacity).toBe('')
  })

  it('does not warn about classic images in the first viewport', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    defaultRect.top = 0
    mount({ width: 320, height: 240, priority: true })
    expect(warn).not.toHaveBeenCalled()
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

  async function hydrate(element: ReactElement) {
    const container = document.createElement('div')
    container.innerHTML = renderToString(element)
    document.body.append(container)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: recoverable })
    })
    const box = container.querySelector<HTMLElement>('[data-state]')!
    return { container, box, img: box.querySelector<HTMLImageElement>(':scope > img')!, errors, recoverable }
  }

  for (const [name, props] of Object.entries(MODES)) {
    it(`hydrates ${name} without a mismatch`, async () => {
      const { errors, recoverable } = await hydrate(<Image src="/a.jpg" alt="" {...props} />)
      await advance()
      expect(errors).not.toHaveBeenCalled()
      expect(recoverable).not.toHaveBeenCalled()
    })
  }

  it('hydrates the average color and switches to the ThumbHash image once triggered', async () => {
    const { box, errors, recoverable } = await hydrate(<Image src="/a.jpg" alt="" width={320} height={240} placeholder={RED} />)
    expect(box.style.backgroundImage).toBe('')
    intersect(box)
    expect(box.style.backgroundImage).toContain('data:image/png;base64,')
    expect(errors).not.toHaveBeenCalled()
    expect(recoverable).not.toHaveBeenCalled()
  })

  it('keeps classic images visible and their server source through hydration', async () => {
    const element = <Image src="/a.jpg" alt="" width={320} height={240} priority />
    const srcset = attr(img(renderToString(element)), 'srcSet')!.replaceAll('&amp;', '&')
    const { img: hydrated } = await hydrate(element)
    await advance(1000)
    expect(hydrated.getAttribute('srcset')).toBe(srcset)
    expect(hydrated.style.opacity).toBe('')
  })

  it('catches a load that finished before hydration', async () => {
    // React attaches its load listener at hydration and does not re-set src
    // on hydrated images, so the ref callback checks `complete` instead.
    const naturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')!
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true })
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 640 })
    try {
      const { box, img: hydrated } = await hydrate(<Image src="/a.jpg" alt="" width={320} height={240} sizes="50vw" />)
      expect(box.dataset.state).toBe('loaded')
      expect(hydrated.style.opacity).toBe('')
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', naturalWidth)
    }
  })

  it('reports a broken image that failed before hydration as an error', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true })
    const { box } = await hydrate(<Image src="/a.jpg" alt="" width={320} height={240} loading="native" />)
    expect(box.dataset.state).toBe('error')
  })

  it('fires onLoad for a classic image that loads after hydration', async () => {
    const onLoad = vi.fn()
    const { box, img: hydrated } = await hydrate(<Image src="/a.jpg" alt="" width={320} height={240} priority onLoad={onLoad} />)
    fireEvent.load(hydrated)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(box.dataset.state).toBe('loaded')
  })
})
