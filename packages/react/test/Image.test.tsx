import { fireEvent, render } from '@testing-library/react'
import { createRef, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { rgbaToThumbHash } from 'thumbhash'
import { describe, expect, it, vi } from 'vitest'
import { LazyEaseProvider, type LazyEaseProviderProps } from '../src/context.js'
import { Image, type ImageProps } from '../src/Image.js'
import { createLoader } from '../src/loader.js'
import { parsePlaceholder } from '../src/placeholder.js'
import {
  MockIntersectionObserver,
  advance,
  decoding,
  defaultRect,
  detectionImage,
  formatDetection,
  intersect,
  media,
  resize,
  setRect,
} from './dom.js'

function mount(props: Partial<ImageProps> = {}, provider: Omit<LazyEaseProviderProps, 'children'> = {}) {
  const element = (p: Partial<ImageProps>): ReactElement => (
    <LazyEaseProvider {...provider}>
      <Image src="/photos/lake.jpg" alt="Lake" width={320} height={240} {...p} />
    </LazyEaseProvider>
  )
  const result = render(element(props))
  const box = () => result.container.querySelector<HTMLElement>('[data-state]')!
  const img = () => box().querySelector<HTMLImageElement>(':scope > img')!
  return { ...result, box, img, rerender: (p: Partial<ImageProps>) => result.rerender(element({ ...props, ...p })) }
}

/** Brings the box into the preload zone and lets measuring and format detection finish. */
async function start(box: HTMLElement) {
  intersect(box)
  await advance()
}

function srcsetWidths(img: HTMLImageElement): number[] {
  return (img.getAttribute('srcset') ?? '').split(', ').map((c) => Number(c.split(' ')[1]!.slice(0, -1)))
}

function solidThumbHash(r: number, g: number, b: number): string {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, 255], i)
  return btoa(String.fromCharCode(...rgbaToThumbHash(8, 8, rgba)))
}

const silence = () => vi.spyOn(console, 'error').mockImplementation(() => {})
const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('layout modes', () => {
  const html = (props: Partial<ImageProps>) =>
    renderToString(<Image src="/a.jpg" alt="" {...props} />).match(/<span[^>]*>/)![0]

  it('renders the box CSS of each mode', () => {
    expect(html({ fill: true })).toContain('position:absolute;inset:0')
    const fixed = html({ width: 320, height: 240 })
    expect(fixed).toContain('width:320px;max-width:100%;aspect-ratio:320 / 240')
    expect(fixed).not.toMatch(/[^-]height:/)
    expect(html({ aspectRatio: 1.5 })).toContain('width:100%;aspect-ratio:1.5')
    expect(html({ aspectRatio: 1.5, width: 300 })).toContain('width:300px;aspect-ratio:1.5')
    expect(html({ width: 300 })).toContain('width:300px')
    expect(html({})).toContain('width:100%')
  })

  it('covers the box with the img except in intrinsic mode', () => {
    const img = (props: Partial<ImageProps>) => renderToString(<Image src="/a.jpg" alt="" {...props} />).match(/<img[^>]*>/)![0]
    for (const props of [{ fill: true }, { width: 320, height: 240 }, { aspectRatio: 2 }]) {
      expect(img(props)).toContain('width:100%;height:100%;object-fit:cover')
    }
    expect(img({ width: 300 })).toContain('height:auto')
    expect(img({ width: 320, height: 240 })).toMatch(/width="320" height="240"/)
  })

  it('never puts opacity or a source into the server markup', () => {
    const markup = renderToString(<Image src="/a.jpg" alt="" width={320} height={240} />).replace(/<noscript>.*<\/noscript>/, '')
    expect(markup).not.toContain('opacity')
    expect(markup).not.toMatch(/src=/i)
  })

  it('throws in development for invalid combinations', () => {
    silence()
    const invalid: Partial<ImageProps>[] = [
      { height: 200, width: undefined },
      { fill: true, width: 300, height: undefined },
      { fill: true, height: 300, width: undefined },
      { width: 300, height: 200, aspectRatio: 1.5 },
      { priority: true, width: undefined, height: undefined },
      { loading: 'native', width: undefined, height: undefined },
    ]
    for (const props of invalid) {
      expect(() => render(<Image src="/a.jpg" alt="" {...props} />), JSON.stringify(props)).toThrow(/\[lazy-ease\]/)
    }
  })

  it('accepts fill with aspectRatio and crops to it', async () => {
    const { box, img } = mount({ fill: true, width: undefined, height: undefined, aspectRatio: 2 })
    setRect(box(), { width: 400, height: 400 })
    await start(box())
    expect(img().getAttribute('srcset')).toContain('ar=2&')
  })

  it('warns about intrinsic mode in development', () => {
    const warn = warnings()
    mount({ width: 300, height: undefined, src: '/intrinsic.jpg' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/intrinsic.jpg has no height'))
  })

  it('forwards ref to the img', () => {
    const ref = createRef<HTMLImageElement>()
    const { img } = mount({ ref })
    expect(ref.current).toBe(img())
  })
})

describe('lazy loading', () => {
  it('sets no src or srcset before the box intersects', async () => {
    const { box, img } = mount()
    await advance(1000)
    expect(img().hasAttribute('src')).toBe(false)
    expect(img().hasAttribute('srcset')).toBe(false)
    expect(box().dataset.state).toBe('idle')

    await start(box())
    expect(img().getAttribute('srcset')).toContain('/_img/photos/lake.jpg?')
    expect(box().dataset.state).toBe('loading')
  })

  it('shares one observer per rootMargin and passes it as scrollMargin', () => {
    const { box } = mount({ rootMargin: '123px' })
    const observers = MockIntersectionObserver.instances.filter((o) => o.elements.has(box()))
    expect(observers).toHaveLength(1)
    expect(observers[0]!.options).toMatchObject({ rootMargin: '123px', scrollMargin: '123px' })
    mount({ rootMargin: '123px', src: '/b.jpg' })
    expect(MockIntersectionObserver.instances.filter((o) => o.options.rootMargin === '123px')).toHaveLength(1)
  })

  it('waits for the dwell time and cancels when the box leaves early', async () => {
    const { box, img } = mount({}, { dwellTime: 300 })
    intersect(box())
    await advance(200)
    intersect(box(), false)
    await advance(1000)
    expect(img().hasAttribute('srcset')).toBe(false)

    intersect(box())
    await advance(299)
    expect(img().hasAttribute('srcset')).toBe(false)
    await advance(1)
    expect(img().hasAttribute('srcset')).toBe(true)
  })

  it('loads eager images without intersection', async () => {
    const { img } = mount({ loading: 'eager' })
    await advance()
    expect(img().hasAttribute('srcset')).toBe(true)
  })
})

describe('measured mode', () => {
  it('sets sizes to the measured width and caps the srcset at 2×', async () => {
    const { box, img } = mount({ width: 412, height: 309 })
    setRect(box(), { width: 412, height: 309 })
    await start(box())
    expect(img().getAttribute('sizes')).toBe('412px')
    // snap(2 × 412) = 828
    expect(srcsetWidths(img())).toEqual([64, 128, 256, 384, 640, 750, 828])
    expect(img().getAttribute('srcset')).toContain('/_img/photos/lake.jpg?ar=1.333&fmt=avif&q=75&w=828 828w')
    expect(img().hasAttribute('src')).toBe(false)
    expect(img().closest('picture')).toBeNull()
  })

  it('caps the srcset at srcWidth', async () => {
    const { box, img } = mount({ srcWidth: 500 })
    setRect(box(), { width: 412 })
    await start(box())
    expect(srcsetWidths(img())).toEqual([64, 128, 256, 384])
  })

  it('passes quality and version to the loader', async () => {
    const { box, img } = mount({ quality: 90, version: 'abc' }, { loader: createLoader({ qualities: [50, 80] }) })
    await start(box())
    expect(img().getAttribute('srcset')).toContain('q=80&v=abc&w=')
  })

  it('waits for format detection and falls back to WebP after 200 ms', async () => {
    formatDetection.hang = true
    const { box, img } = mount()
    await start(box())
    await advance(199)
    expect(img().hasAttribute('srcset')).toBe(false)
    await advance(1)
    expect(img().getAttribute('srcset')).toContain('fmt=webp')
  })

  it('skips detection for loaders with formats: auto', async () => {
    formatDetection.hang = true
    const loader = { ...createLoader(), formats: 'auto' as const }
    const { box, img } = mount({}, { loader })
    await start(box())
    expect(img().getAttribute('srcset')).toContain('fmt=auto')
  })

  it('accepts a function loader', async () => {
    const { box, img } = mount({}, { loader: ({ width, format }) => `/cdn/${width}.${format}` })
    await start(box())
    expect(img().getAttribute('srcset')).toContain('/cdn/64.avif 64w')
  })

  it('waits for a hidden eager box to get a size', async () => {
    defaultRect.width = 0
    const { box, img } = mount({ loading: 'eager' })
    await advance(1000)
    expect(img().hasAttribute('srcset')).toBe(false)
    resize(box(), { width: 300 })
    await advance()
    expect(img().getAttribute('sizes')).toBe('300px')
  })

  it('raises sizes only when the candidate changes, after a 200 ms debounce', async () => {
    const { box, img } = mount()
    setRect(box(), { width: 300 })
    await start(box())
    expect(img().getAttribute('sizes')).toBe('300px')

    // 350 still selects 384.
    resize(box(), { width: 350 })
    await advance(500)
    expect(img().getAttribute('sizes')).toBe('300px')

    // 400 selects 640: written after the debounce, which restarts on every event.
    resize(box(), { width: 380 })
    await advance(100)
    resize(box(), { width: 400 })
    await advance(199)
    expect(img().getAttribute('sizes')).toBe('300px')
    await advance(1)
    expect(img().getAttribute('sizes')).toBe('400px')
    // The cap moves with the width: snap(800) = 828.
    expect(srcsetWidths(img()).at(-1)).toBe(828)

    resize(box(), { width: 200 })
    await advance(500)
    expect(img().getAttribute('sizes')).toBe('400px')
  })

  it('uses the device pixel ratio to decide whether the candidate changed', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const { box, img } = mount()
    setRect(box(), { width: 300 })
    await start(box())
    // 2 × 330 = 660 selects 750, where 2 × 300 selected 640.
    resize(box(), { width: 330 })
    await advance(200)
    expect(img().getAttribute('sizes')).toBe('330px')
  })

  it('rebuilds the srcset when the fill ratio crosses a ladder step', async () => {
    const { box, img } = mount({ fill: true, width: undefined, height: undefined })
    setRect(box(), { width: 400, height: 300 })
    await start(box())
    const initial = img().getAttribute('srcset')!
    expect(initial).toContain('ar=1.333&')

    // 400 / 299 = 1.338 still snaps to 1.333.
    resize(box(), { width: 400, height: 299 })
    await advance(200)
    expect(img().getAttribute('srcset')).toBe(initial)

    resize(box(), { width: 400, height: 250 })
    await advance(200)
    expect(img().getAttribute('srcset')).not.toBe(initial)
    expect(img().getAttribute('srcset')).toContain('ar=1.61&')
    expect(img().getAttribute('sizes')).toBe('400px')
  })

  it('does not track the box ratio outside fill mode', async () => {
    const { box, img } = mount({ width: undefined, height: undefined, aspectRatio: 1.5 })
    setRect(box(), { width: 300, height: 200 })
    await start(box())
    const initial = img().getAttribute('srcset')
    resize(box(), { width: 300, height: 100 })
    await advance(200)
    expect(img().getAttribute('srcset')).toBe(initial)
  })

  it('warns about measured images in the first viewport', () => {
    const warn = warnings()
    defaultRect.top = 0
    mount({ src: '/hero.jpg' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/hero.jpg is in the first viewport'))
  })

  it('does not warn about images below the fold', () => {
    const warn = warnings()
    mount({ src: '/below.jpg' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('fade', () => {
  async function loading(props: Partial<ImageProps> = {}, provider: Omit<LazyEaseProviderProps, 'children'> = {}) {
    const mounted = mount(props, provider)
    await start(mounted.box())
    return mounted
  }

  it('applies opacity 0 when it sets the srcset', async () => {
    const { box, img } = mount()
    expect(img().style.opacity).toBe('')
    await start(box())
    expect(img().style.opacity).toBe('0')
  })

  it('stays hidden until decode resolves, then fades in', async () => {
    let finish!: () => void
    const { img, box } = await loading()
    vi.spyOn(img(), 'decode').mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    fireEvent.load(img())
    await advance(100)
    expect(img().style.opacity).toBe('0')
    expect(box().dataset.state).toBe('loading')
    finish()
    await advance()
    expect(img().style.opacity).toBe('1')
    expect(img().style.transition).toBe('opacity 400ms ease-out')
    expect(box().dataset.state).toBe('loaded')
  })

  it('treats a rejected decode like a resolved one', async () => {
    decoding.behavior = 'reject'
    const { img } = await loading()
    fireEvent.load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
  })

  it('shows the image after 250 ms when decode never settles', async () => {
    decoding.behavior = 'hang'
    const { img } = await loading()
    fireEvent.load(img())
    await advance(249)
    expect(img().style.opacity).toBe('0')
    await advance(1)
    expect(img().style.opacity).toBe('1')
  })

  it('ignores a decode that finishes after the srcset changed', async () => {
    let finish!: () => void
    const { box, img } = mount()
    setRect(box(), { width: 300 })
    await start(box())
    vi.spyOn(img(), 'decode').mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    fireEvent.load(img())

    resize(box(), { width: 700 })
    await advance(200)
    expect(img().getAttribute('sizes')).toBe('700px')
    finish()
    await advance()
    expect(img().style.opacity).toBe('0')

    // The new candidate's own load reveals it.
    fireEvent.load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
  })

  it('does not fade again on srcset upgrades', async () => {
    const onLoad = vi.fn()
    const { box, img } = mount({ onLoad })
    setRect(box(), { width: 300 })
    await start(box())
    fireEvent.load(img())
    await advance()
    resize(box(), { width: 700 })
    await advance(200)
    fireEvent.load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('swaps instantly with fadeDuration 0 or reduced motion', async () => {
    const instant = await loading({ src: '/instant.jpg' }, { fadeDuration: 0 })
    fireEvent.load(instant.img())
    await advance()
    expect(instant.img().style.opacity).toBe('1')
    expect(instant.img().style.transition).toBe('')
    instant.unmount()

    media.reducedMotion = true
    const reduced = await loading({ src: '/reduced.jpg', fadeDuration: 800 })
    fireEvent.load(reduced.img())
    await advance()
    expect(reduced.img().style.opacity).toBe('1')
    expect(reduced.img().style.transition).toBe('')
  })

  it('reports a complete image with naturalWidth 0 as an error', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true })
    const { box, img } = await loading()
    expect(img().naturalWidth).toBe(0)
    expect(box().dataset.state).toBe('error')
    expect(img().style.opacity).toBe('0')
  })

  it('reveals an image that is already complete without a load event', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true })
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 640 })
    const { box, img } = await loading()
    await advance()
    expect(box().dataset.state).toBe('loaded')
    expect(img().style.opacity).toBe('1')
    // @ts-expect-error restores jsdom's own getter
    delete HTMLImageElement.prototype.naturalWidth
  })

  it('keeps the placeholder and sets data-state="error" on error', async () => {
    const onError = vi.fn()
    const { box, img } = await loading({ placeholder: '#123456', onError })
    fireEvent.error(img())
    expect(box().dataset.state).toBe('error')
    expect(box().style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(img().style.opacity).toBe('0')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('never hides classic-mode images', async () => {
    const { box, img } = mount({ sizes: '50vw' })
    await start(box())
    expect(img().hasAttribute('srcset')).toBe(true)
    expect(img().style.opacity).toBe('')
    fireEvent.load(img())
    expect(box().dataset.state).toBe('loaded')
  })
})

describe('state', () => {
  it('goes idle → loading → loaded and fires onLoad once', async () => {
    const onLoad = vi.fn()
    const { box, img } = mount({ onLoad })
    expect(box().dataset.state).toBe('idle')
    await start(box())
    expect(box().dataset.state).toBe('loading')
    fireEvent.load(img())
    expect(onLoad).not.toHaveBeenCalled()
    await advance()
    expect(box().dataset.state).toBe('loaded')
    fireEvent.load(img())
    await advance()
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('resets to idle with the placeholder when src changes', async () => {
    const { box, img, rerender } = mount({ placeholder: '#123456' })
    await start(box())
    fireEvent.load(img())
    await advance()
    await advance(400)
    expect(box().style.backgroundColor).toBe('')

    rerender({ src: '/photos/other.jpg' })
    expect(box().dataset.state).toBe('idle')
    expect(img().hasAttribute('srcset')).toBe(false)
    expect(box().style.backgroundColor).toBe('rgb(18, 52, 86)')
    await start(box())
    expect(img().getAttribute('srcset')).toContain('/photos/other.jpg')
  })
})

describe('placeholder', () => {
  const RED = solidThumbHash(255, 0, 0)

  it('renders a color as background-color', () => {
    const { box } = mount({ placeholder: '#5b6c8f' })
    expect(box().style.backgroundColor).toBe('rgb(91, 108, 143)')
  })

  it('renders a data URI as a covering background image', () => {
    const { box } = mount({ placeholder: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(box().style.backgroundImage).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(box().style.backgroundSize).toBe('cover')
  })

  it('renders nothing for none', () => {
    const { box } = mount({ placeholder: 'none' })
    expect(box().style.background).toBe('')
    expect(box().style.backgroundColor).toBe('')
  })

  it('uses the provider default when there is no prop', () => {
    expect(mount({}).box().style.backgroundColor).toBe('rgb(229, 231, 235)')
  })

  it('warns about an invalid placeholder and falls back to the provider default', () => {
    const warn = warnings()
    const { box } = mount({ placeholder: 'red;}', src: '/bad.jpg' }, { placeholder: '#000' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid placeholder for /bad.jpg'))
    expect(box().style.backgroundColor).toBe('rgb(0, 0, 0)')
  })

  it('renders only the average color of a ThumbHash on the server, the image after mount', () => {
    const server = renderToString(<Image src="/a.jpg" alt="" fill placeholder={`thumbhash:${RED}`} />)
    expect(server).toMatch(/background-color:#f[ef]000[01]/)
    expect(server).not.toContain('background-image')

    const { box } = mount({ placeholder: `thumbhash:${RED}` })
    expect(box().style.backgroundImage).toContain('data:image/png;base64,')
  })

  it('decodes the ThumbHash on the server with thumbhashSsr image or priority', () => {
    const withProvider = renderToString(
      <LazyEaseProvider thumbhashSsr="image">
        <Image src="/a.jpg" alt="" fill placeholder={`thumbhash:${RED}`} />
      </LazyEaseProvider>,
    )
    expect(withProvider).toContain('background-image:url(&quot;data:image/png;base64,')
    const priority = renderToString(<Image src="/a.jpg" alt="" sizes="100vw" fill priority placeholder={`thumbhash:${RED}`} />)
    expect(priority).toContain('background-image:url(&quot;data:image/png;base64,')
  })

  it('removes the background once the image is loaded and faded in', async () => {
    const hash = `thumbhash:${RED}`
    const { box, img } = mount({ placeholder: hash })
    await start(box())
    fireEvent.load(img())
    await advance()
    expect(box().dataset.state).toBe('loaded')
    expect(box().style.backgroundImage).not.toBe('')
    await advance(400)
    expect(box().style.backgroundImage).toBe('')
    expect(box().style.backgroundColor).toBe('')
    expect(parsePlaceholder(hash).kind).toBe('thumbhash')
  })
})

describe('external images', () => {
  it('uses src as is with no srcset', async () => {
    const { box, img } = mount({ src: 'https://other.site/a.jpg' })
    expect(img().hasAttribute('src')).toBe(false)
    await start(box())
    expect(img().getAttribute('src')).toBe('https://other.site/a.jpg')
    expect(img().hasAttribute('srcset')).toBe(false)
    expect(img().hasAttribute('sizes')).toBe(false)
    expect(img().style.objectFit).toBe('cover')
    expect(img().style.opacity).toBe('0')
    fireEvent.load(img())
    await advance()
    expect(img().style.opacity).toBe('1')
  })

  it('treats configured domains as owned', async () => {
    const { box, img } = mount({ src: 'https://cdn.example.com/a.jpg' }, { domains: ['cdn.example.com'] })
    await start(box())
    expect(img().getAttribute('srcset')).toContain('/_img/a.jpg?')
  })

  it('forces external behavior with unoptimized and ignores a loader prop with a warning', async () => {
    const warn = warnings()
    const loader = vi.fn(() => '/never')
    const { box, img } = mount({ src: '/local.jpg', unoptimized: true, loader })
    await start(box())
    expect(img().getAttribute('src')).toBe('/local.jpg')
    expect(loader).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`loader` prop is ignored'))
  })
})

describe('no-JS fallback', () => {
  it('renders the classic srcset in <noscript>', () => {
    const markup = renderToString(<Image src="/a.jpg" alt="Lake" width={320} height={240} srcWidth={1000} />)
    const noscript = markup.match(/<noscript>(.*)<\/noscript>/)![1]!
    expect(noscript).toContain('<img')
    expect(noscript).toContain('loading="lazy"')
    expect(noscript).toContain('alt="Lake"')
    expect(noscript).toContain('sizes="100vw"')
    expect(noscript).toContain('/_img/a.jpg?ar=1.333&amp;fmt=webp&amp;q=75&amp;w=64 64w')
    expect(noscript).toContain('w=828 828w')
    expect(noscript).not.toContain('w=1080')
  })

  it('uses src for external images', () => {
    const external = renderToString(<Image src="https://other.site/a.jpg" alt="" fill />)
    expect(external).toMatch(/<noscript><img[^>]*src="https:\/\/other.site\/a.jpg"/)
  })
})

describe('provider', () => {
  it('starts format detection on mount', async () => {
    render(<LazyEaseProvider>{null}</LazyEaseProvider>)
    await advance()
    expect(detectionImage.created).toBeGreaterThan(0)
  })
})
