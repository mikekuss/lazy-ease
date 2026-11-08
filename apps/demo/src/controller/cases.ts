import type { ResolvedLoader } from '@lazy-ease/core'
import { shortUrl, watchStyle, type Case, type CaseContext, type SourceImage } from './harness'

const ratioOf = (image: SourceImage) => image.width / image.height
const landscape = (ctx: CaseContext, nth = 0) => pick(ctx.images.filter((image) => ratioOf(image) > 1.2), ctx, nth)
const portrait = (ctx: CaseContext, nth = 0) => pick(ctx.images.filter((image) => ratioOf(image) < 0.9), ctx, nth)
const pick = (list: readonly SourceImage[], ctx: CaseContext, nth: number) =>
  list.length ? list[nth % list.length]! : ctx.images[nth % ctx.images.length]!

const metadata = (image: SourceImage) => ({ srcWidth: image.width, srcHeight: image.height })
const stateOf = (box: HTMLElement) => box.getAttribute('data-state')
const sizesOf = (img: HTMLImageElement) => Number.parseInt(img.getAttribute('sizes') ?? '0', 10)
const candidates = (img: HTMLImageElement) => (img.getAttribute('srcset') ?? '').split(',').filter(Boolean).length

/** A scroll container with a spacer above the content, so it starts out of view. */
function scroller(ctx: CaseContext, gap = 520) {
  const root = document.createElement('div')
  root.className = 'scroller'
  const spacer = document.createElement('div')
  spacer.className = 'spacer'
  spacer.style.height = `${gap}px`
  spacer.textContent = 'Scrolls down by itself'
  const content = document.createElement('div')
  root.append(spacer, content)
  ctx.stage.append(root)
  return { root, content, scrollIn: () => root.scrollTo({ top: gap, behavior: 'smooth' }), scrollOut: () => root.scrollTo({ top: 0 }) }
}

/** Live `sizes`, shown width and box size for geometry cases. */
function geometry(ctx: CaseContext, box: HTMLElement, img: HTMLImageElement) {
  const sizes = ctx.readout('sizes')
  const shown = ctx.readout('shown candidate')
  const size = ctx.readout('box')
  const timer = setInterval(() => {
    if (!ctx.alive) return clearInterval(timer)
    sizes(img.getAttribute('sizes') ?? '(none)')
    shown(shortUrl(img.currentSrc))
    size(`${Math.round(box.clientWidth)} × ${Math.round(box.clientHeight)} px`)
  }, 100)
}

/** Breaks every URL wider than `limit`, so an upgrade past it fails. */
function breakAbove(loader: ResolvedLoader, limit: number): ResolvedLoader {
  return { ...loader, url: (request) => loader.url(request.width > limit ? { ...request, src: '/missing.jpg' } : request) }
}

export const CASES: Case[] = [
  // Loading
  {
    id: 'measured',
    group: 'Loading',
    title: 'Measured image with a color placeholder',
    about: 'A src plus a loader: the controller measures the box, installs candidates for its width and fades the image in over the color.',
    async run(ctx) {
      const image = landscape(ctx)
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      const le = ctx.lazyEase({ loader: ctx.loader() })
      const a = le.attach(img, { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      geometry(ctx, box, img)
      await ctx.expect('Placeholder color painted on the box', () => box.style.backgroundColor !== '')
      await ctx.expect('Candidates installed as srcset', () => candidates(img) > 0)
      ctx.assert('sizes covers the box width', sizesOf(img) >= box.clientWidth, `${sizesOf(img)}px for ${box.clientWidth}px`)
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
      ctx.assert('data-state on the box', stateOf(box) === 'loaded')
      await ctx.expect('Placeholder removed after the fade', () => box.style.backgroundColor === '' && img.style.opacity === '')
      await ctx.wait(300)
      ctx.assert('onDisplay fired exactly once, with the load event', a.displays.length === 1 && a.displays[0]!.event)
    },
  },
  {
    id: 'thumbhash',
    group: 'Loading',
    title: 'ThumbHash placeholder',
    about: 'The average color shows at once; the decoded preview is swapped in when the image activates, and removed when it is displayed.',
    async run(ctx) {
      const image = portrait(ctx)
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-4-5')
      const le = ctx.lazyEase({ loader: ctx.loader() })
      let sawPreview = false
      const stop = watchStyle(box, (style) => (sawPreview ||= style.backgroundImage.startsWith('url("data:image/png')))
      const a = le.attach(img, { src: image.src, aspectRatio: 4 / 5, placeholder: `thumbhash:${image.thumbhash}`, ...metadata(image) })
      ctx.assert('Average color painted synchronously', box.style.backgroundColor !== '')
      await ctx.expect('Decoded preview painted on activation', () => sawPreview)
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
      await ctx.expect('Preview removed after the fade', () => box.style.backgroundImage === '')
      stop()
    },
  },
  {
    id: 'prepared',
    group: 'Loading',
    title: 'Prepared srcset and sizes',
    about: 'A server-rendered candidate list is copied as is, without measuring the box.',
    async run(ctx) {
      const image = landscape(ctx, 1)
      const loader = ctx.loader()
      const srcset = [384, 640, 1080]
        .map((w) => `${loader.url({ src: image.src, width: w, quality: 75, format: 'webp' })} ${w}w`)
        .join(', ')
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      const le = ctx.lazyEase()
      const a = le.attach(img, { srcset, sizes: '(min-width: 700px) 384px, 100vw', placeholder: image.color })
      await ctx.expect('srcset copied unchanged', () => img.getAttribute('srcset') === srcset)
      ctx.assert('sizes copied unchanged', img.getAttribute('sizes') === '(min-width: 700px) 384px, 100vw')
      await ctx.expect('Reaches loaded', () => a.state === 'loaded' && stateOf(box) === 'loaded')
    },
  },
  {
    id: 'custom-root',
    group: 'Loading',
    title: 'Lazy inside a custom scroll root',
    about: 'The image waits in a scroll container until it comes near its view. rootMargin is 0 here, so the spacer keeps it idle.',
    async run(ctx) {
      const image = landscape(ctx, 2)
      const s = scroller(ctx)
      const { img } = ctx.box(s.content, 'frame ratio-3-2')
      const le = ctx.lazyEase({ loader: ctx.loader(), root: s.root, rootMargin: '0px' })
      const a = le.attach(img, { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      await ctx.never('Stays idle while out of view', () => a.state !== 'idle' || img.hasAttribute('srcset'), 1200)
      s.scrollIn()
      await ctx.expect('Activates once scrolled into view', () => a.state !== 'idle')
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
    },
  },
  {
    id: 'dwell',
    group: 'Loading',
    title: 'Dwell time',
    about: 'With dwellTime 800 ms a quick pass through the view does not load; staying in view does.',
    async run(ctx) {
      const image = portrait(ctx, 1)
      const s = scroller(ctx)
      const { img } = ctx.box(s.content, 'frame ratio-3-2')
      const le = ctx.lazyEase({ loader: ctx.loader(), root: s.root, rootMargin: '0px', dwellTime: 800 })
      const a = le.attach(img, { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      s.root.scrollTo({ top: 520 })
      ctx.log('scrolled in for 300 ms')
      await ctx.wait(300)
      s.scrollOut()
      ctx.log('scrolled out again')
      await ctx.never('A 300 ms pass does not activate', () => a.state !== 'idle', 1200)
      s.root.scrollTo({ top: 520 })
      const entered = performance.now()
      ctx.log('scrolled in to stay')
      await ctx.expect('Activates after staying in view', () => a.state !== 'idle')
      ctx.assert('Not before the dwell time', performance.now() - entered >= 750, `${Math.round(performance.now() - entered)} ms`)
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
    },
  },

  // Adoption
  {
    id: 'priority',
    group: 'Adoption',
    title: 'Priority image adopts its HTML',
    about: 'A hero rendered with its candidates in the HTML: the controller keeps them, sets high fetch priority, and shows it without a fade.',
    async run(ctx) {
      const image = landscape(ctx, 3)
      const loader = ctx.loader()
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      img.srcset = [640, 1080].map((w) => `${loader.url({ src: image.src, width: w, quality: 75, format: 'webp' })} ${w}w`).join(', ')
      img.sizes = `${box.clientWidth}px`
      const html = img.getAttribute('srcset')
      let faded = false
      const stop = watchStyle(img, (style) => (faded ||= style.opacity === '0'))
      const a = ctx.lazyEase().attach(img, { priority: true, placeholder: image.color })
      ctx.assert('fetchpriority="high" and loading="eager"', img.getAttribute('fetchpriority') === 'high' && img.loading === 'eager')
      ctx.assert('HTML srcset kept', img.getAttribute('srcset') === html)
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
      ctx.assert('Never hidden for a fade', !faded)
      stop()
    },
  },
  {
    id: 'priority-update',
    group: 'Adoption',
    title: 'update() on a priority image',
    about: 'The new hero sources are set first, then update(): the native generation adopts them instead of blanking the image.',
    async run(ctx) {
      const [first, second] = [landscape(ctx, 0), landscape(ctx, 1)]
      const loader = ctx.loader()
      const { img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      img.src = loader.url({ src: first.src, width: 640, quality: 75, format: 'webp' })
      const a = ctx.lazyEase().attach(img, { priority: true })
      await ctx.expect('First hero loaded', () => a.state === 'loaded')
      const next = loader.url({ src: second.src, width: 640, quality: 75, format: 'webp' })
      img.src = next
      a.update({ priority: true })
      ctx.log('new src set, then update()')
      ctx.assert('New src kept', img.getAttribute('src') === next)
      await ctx.expect('Second hero loaded', () => a.state === 'loaded' && img.currentSrc.endsWith(next.slice(next.indexOf('/_img'))))
    },
  },
  {
    id: 'cached',
    group: 'Adoption',
    title: 'Cached image adopted without reloading',
    about: 'The image already finished loading before attach: the controller displays it at once and fires onDisplay without an event.',
    async run(ctx) {
      const image = portrait(ctx, 2)
      const url = ctx.loader().url({ src: image.src, width: 384, quality: 75, format: 'webp' })
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      img.src = url
      await ctx.expect('Browser finished loading before attach', () => img.complete && img.naturalWidth > 0)
      const a = ctx.lazyEase().attach(img, { url, placeholder: image.color })
      ctx.assert('Loaded synchronously on attach', a.state === 'loaded' && stateOf(box) === 'loaded')
      ctx.assert('onDisplay once, without a fabricated event', a.displays.length === 1 && !a.displays[0]!.event)
    },
  },
  {
    id: 'adopt-error',
    group: 'Adoption',
    title: 'Broken image adopted as an error',
    showsError: true,
    about: 'The image failed before attach: the state is error at once and the alt text shows in the reserved box.',
    async run(ctx) {
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2', 'Alt text of a missing image')
      img.src = '/_img/missing.jpg?fmt=webp&q=75&w=384'
      await ctx.expect('Browser gave up before attach', () => img.complete)
      const a = ctx.lazyEase().attach(img, { url: img.getAttribute('src')!, placeholder: '#cbd5e1' })
      ctx.assert('Error on attach', a.state === 'error' && stateOf(box) === 'error')
      ctx.assert('Placeholder released', box.style.backgroundColor === '')
      await ctx.never('Stays error, no new attempt', () => a.state !== 'error', 1500)
    },
  },

  // Failures
  {
    id: 'error',
    group: 'Failures',
    title: 'Load error',
    showsError: true,
    about: 'The target 404s: the state becomes error, the placeholder goes, the alt text stays visible.',
    async run(ctx) {
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2', 'Alt text of a missing image')
      const a = ctx.lazyEase({ loader: ctx.loader() }).attach(img, { src: '/missing.jpg', aspectRatio: 3 / 2, placeholder: '#cbd5e1' })
      await ctx.expect('Reaches error', () => a.state === 'error' && stateOf(box) === 'error')
      ctx.assert('Image not left hidden', img.style.opacity === '')
      ctx.assert('Placeholder released', box.style.backgroundColor === '')
    },
  },
  {
    id: 'failed-upgrade',
    group: 'Failures',
    title: 'Failed upgrade keeps the displayed image',
    about: 'Candidates above a width limit 404. After the box grows past it, the upgrade fails and the shown image and state stay.',
    async run(ctx) {
      const image = landscape(ctx, 4)
      const dpr = devicePixelRatio || 1
      const limit = Math.ceil(320 * dpr)
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2 narrow')
      const a = ctx.lazyEase({ loader: breakAbove(ctx.loader(), limit) }).attach(img, {
        src: image.src,
        aspectRatio: 3 / 2,
        placeholder: image.color,
        ...metadata(image),
      })
      geometry(ctx, box, img)
      await ctx.expect('Small image loaded', () => a.state === 'loaded' && img.complete)
      const before = img.currentSrc
      const small = sizesOf(img)
      // The 404 comes back within milliseconds, so record every sizes value.
      const history: number[] = []
      const observer = new MutationObserver(() => history.push(sizesOf(img)))
      observer.observe(img, { attributes: true, attributeFilter: ['sizes'] })
      box.classList.replace('narrow', 'wide')
      ctx.log(`box widened; candidates over ${limit}w now 404`)
      await ctx.expect('Upgrade attempted (sizes grew)', () => history.some((value) => value > small))
      await ctx.expect('Previous candidates restored after the error', () => sizesOf(img) === small && img.currentSrc === before, 8000)
      ctx.assert('State stays loaded', a.state === 'loaded')
      const attempts = history.length
      await ctx.never('No retry loop', () => history.length > attempts, 1500)
      observer.disconnect()
      ctx.log(`sizes went ${[small, ...history].map((v) => `${v}px`).join(' → ')}`)
    },
  },

  // Geometry
  {
    id: 'grow',
    group: 'Geometry',
    title: 'Resize grows, never shrinks',
    about: 'Widening the box requests larger candidates after a 200 ms settle; narrowing it keeps what is there.',
    async run(ctx) {
      const image = landscape(ctx, 5)
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2 narrow resizable')
      const a = ctx.lazyEase({ loader: ctx.loader() }).attach(img, { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      geometry(ctx, box, img)
      await ctx.expect('Loaded at the small size', () => a.state === 'loaded')
      const small = sizesOf(img)
      box.classList.replace('narrow', 'wide')
      ctx.log('box widened')
      await ctx.expect('sizes grew to the wider box', () => sizesOf(img) >= box.clientWidth && sizesOf(img) > small)
      const large = sizesOf(img)
      box.classList.replace('wide', 'narrow')
      ctx.log('box narrowed')
      await ctx.never('sizes does not shrink', () => sizesOf(img) < large, 1000)
      ctx.log('Drag the corner of the box to try it by hand')
    },
  },
  {
    id: 'height-only',
    group: 'Geometry',
    title: 'Height-only resize with browser crop',
    about: 'A fill box cropped by the browser needs the cover width, max(width, height × source ratio), so growing only its height requests wider candidates.',
    async run(ctx) {
      const image = landscape(ctx, 6)
      const cell = document.createElement('div')
      cell.className = 'cell short'
      ctx.stage.append(cell)
      const { box, img } = ctx.box(cell, 'fill')
      const a = ctx.lazyEase({ loader: ctx.loader() }).attach(img, { src: image.src, fill: true, crop: 'browser', placeholder: image.color, ...metadata(image) })
      geometry(ctx, box, img)
      await ctx.expect('Loaded', () => a.state === 'loaded')
      const before = sizesOf(img)
      cell.classList.replace('short', 'tall')
      ctx.log('cell height only grew')
      const cover = () => Math.ceil(Math.max(box.clientWidth, box.clientHeight * ratioOf(image)))
      await ctx.expect('sizes grew to the cover width', () => sizesOf(img) > before && sizesOf(img) >= cover() - 1)
    },
  },
  {
    id: 'zero-size',
    group: 'Geometry',
    title: 'Zero-sized cell waits for a size',
    about: 'A collapsed fill cell installs nothing; once it gets a height, the image loads at the right size.',
    async run(ctx) {
      const image = portrait(ctx, 3)
      const cell = document.createElement('div')
      cell.className = 'cell collapsed'
      ctx.stage.append(cell)
      const { box, img } = ctx.box(cell, 'fill')
      const a = ctx.lazyEase({ loader: ctx.loader() }).attach(img, { src: image.src, fill: true, aspectRatio: 1, placeholder: image.color, ...metadata(image) })
      geometry(ctx, box, img)
      await ctx.never('No candidates while the cell has no height', () => img.hasAttribute('srcset'), 1200)
      cell.classList.replace('collapsed', 'short')
      ctx.log('cell got a height')
      await ctx.expect('Loads once sized', () => a.state === 'loaded' && sizesOf(img) >= box.clientWidth)
    },
  },
  {
    id: 'focal',
    group: 'Geometry',
    title: 'Focal point',
    about: 'A wide crop of a tall image, cropped by the browser, keeps the focal point (20 %, 25 %) in view through object-position.',
    async run(ctx) {
      const image = portrait(ctx, 4)
      const row = document.createElement('div')
      row.className = 'pair'
      ctx.stage.append(row)
      const centered = ctx.box(row, 'frame ratio-21-9')
      const focused = ctx.box(row, 'frame ratio-21-9')
      const le = ctx.lazyEase({ loader: ctx.loader() })
      const common = { src: image.src, aspectRatio: 21 / 9, crop: 'browser' as const, placeholder: image.color, ...metadata(image) }
      const a = le.attach(centered.img, common)
      const b = le.attach(focused.img, { ...common, focalPoint: { x: 20, y: 25 } })
      ctx.readout('without focal point')(centered.img.style.objectPosition || '(default, center)')
      const position = ctx.readout('with focal point')
      await ctx.expect('Both loaded', () => a.state === 'loaded' && b.state === 'loaded')
      position(focused.img.style.objectPosition)
      ctx.assert('Focal image is positioned off-center', !['', '50% 50%', 'center'].includes(focused.img.style.objectPosition))
      ctx.assert('Centered image has none', centered.img.style.objectPosition === '')
      b.update({ ...common })
      ctx.log('update() without a focal point')
      await ctx.expect('Focal styles cleared by update()', () => focused.img.style.objectPosition === '')
    },
  },

  // Sources and formats
  {
    id: 'external',
    group: 'Sources and formats',
    title: 'External URL passes through',
    about: 'An absolute URL loads directly unless its host is listed in domains. None are listed here, so even this same-origin URL gets no candidates.',
    async run(ctx) {
      const image = landscape(ctx, 7)
      const url = `${location.origin}/external/${image.file}`
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      const a = ctx.lazyEase({ loader: ctx.loader() }).attach(img, { src: url, aspectRatio: 3 / 2, placeholder: image.color })
      await ctx.expect('src set as is', () => img.getAttribute('src') === url)
      ctx.assert('No srcset', !img.hasAttribute('srcset'))
      await ctx.expect('Reaches loaded', () => a.state === 'loaded' && stateOf(box) === 'loaded')
    },
  },
  {
    id: 'svg',
    group: 'Sources and formats',
    title: 'SVG passes through without a loader',
    about: 'Vector images are never resized, so an SVG src needs no loader at all.',
    async run(ctx) {
      const svg = `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="#0f766e"/><circle cx="60" cy="40" r="24" fill="#99f6e4"/></svg>',
      )}`
      const { img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      const a = ctx.lazyEase().attach(img, { src: svg, aspectRatio: 3 / 2 })
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
      ctx.assert('No srcset', !img.hasAttribute('srcset'))
    },
  },
  {
    id: 'formats',
    group: 'Sources and formats',
    title: 'Loaders get the format they declare',
    about: "A single format is requested as is; 'auto' is passed to the loader for the server to negotiate; a list takes the best format the browser decodes.",
    async run(ctx) {
      const image = landscape(ctx, 8)
      const row = document.createElement('div')
      row.className = 'triple'
      ctx.stage.append(row)
      const webp = ctx.box(row, 'frame ratio-3-2', 'WebP only')
      const auto = ctx.box(row, 'frame ratio-3-2', 'auto')
      const list = ctx.box(row, 'frame ratio-3-2', 'AVIF, WebP')
      const base = ctx.loader()
      // The demo server has no Accept negotiation and needs fmt, so this loader
      // stands in for one: it records what it was asked for and serves JPEG.
      const asked = new Set<string>()
      const autoLoader: ResolvedLoader = {
        ...base,
        formats: 'auto',
        url: (request) => {
          asked.add(request.format)
          return base.url({ ...request, format: request.format === 'auto' ? 'jpeg' : request.format })
        },
      }
      const le = ctx.lazyEase()
      const common = { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) }
      const a = le.attach(webp.img, { ...common, loader: { ...base, formats: ['webp'] } })
      const b = le.attach(auto.img, { ...common, loader: autoLoader })
      const c = le.attach(list.img, { ...common, loader: { ...base, formats: ['avif', 'webp'] } })
      const fmt = (img: HTMLImageElement) => new URL(img.currentSrc || 'about:blank', location.href).searchParams.get('fmt')
      await ctx.expect('All three loaded', () => [a, b, c].every((x) => x.state === 'loaded'))
      ctx.readout('WebP only')(fmt(webp.img) ?? '(none)')
      ctx.readout('auto')(`loader asked for ${[...asked].join(', ')}`)
      ctx.readout('AVIF, WebP')(fmt(list.img) ?? '(none)')
      ctx.assert('WebP-only requests fmt=webp', fmt(webp.img) === 'webp')
      ctx.assert("auto passes 'auto' to the loader", asked.size === 1 && asked.has('auto'))
      ctx.assert('A list picks a format it declares', ['avif', 'webp'].includes(fmt(list.img) ?? ''))
    },
  },

  // Lifecycle
  {
    id: 'update',
    group: 'Lifecycle',
    title: 'update() switches the source',
    about: "A new logical source starts a new generation: the placeholder returns, the old image doesn't linger, onDisplay fires for each source.",
    async run(ctx) {
      const [first, second] = [landscape(ctx, 0), portrait(ctx, 0)]
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      const le = ctx.lazyEase({ loader: ctx.loader() })
      const options = (image: SourceImage) => ({ src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      const a = le.attach(img, options(first))
      await ctx.expect('First source loaded', () => a.state === 'loaded' && box.style.backgroundColor === '')
      a.update(options(second))
      ctx.log('update() to the second image')
      ctx.assert('Placeholder back at once', box.style.backgroundColor !== '')
      ctx.assert('Old target removed', !img.hasAttribute('srcset') || !img.getAttribute('srcset')!.includes(first.src))
      await ctx.expect('Second source loaded', () => a.state === 'loaded' && (img.getAttribute('srcset') ?? '').includes(second.src))
      await ctx.wait(300)
      ctx.assert('onDisplay once per source', a.displays.length === 2, `${a.displays.length} calls`)
    },
  },
  {
    id: 'destroy',
    group: 'Lifecycle',
    title: 'destroy() during a slow load',
    about: 'Destroyed after the target is assigned but before it arrives: the image must not stay invisible when it loads.',
    async run(ctx) {
      const image = landscape(ctx, 9)
      const { box, img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      // Slow enough that destroy() lands between assigning the target and its arrival.
      const loader = ctx.loader({ params: { throttle: 'custom', latency: 1500, kbps: 200 } })
      const a = ctx.lazyEase({ loader }).attach(img, { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      await ctx.expect('Target assigned', () => img.hasAttribute('srcset'))
      ctx.assert('Hidden for the fade before destroy()', img.style.opacity === '0' && a.state === 'loading')
      a.destroy()
      ctx.log('destroy() while loading')
      ctx.assert('Not left at opacity 0', img.style.opacity !== '0')
      await ctx.expect('The browser still shows the image', () => img.complete && img.naturalWidth > 0)
      ctx.assert('data-state no longer changes', stateOf(box) === 'loading')
    },
  },
  {
    id: 'no-fade',
    group: 'Lifecycle',
    title: 'fadeDuration 0 swaps directly',
    about: 'With no fade (as with prefers-reduced-motion) the image never gets an opacity transition.',
    async run(ctx) {
      const image = portrait(ctx, 5)
      const { img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      let transition = false
      const stop = watchStyle(img, (style) => (transition ||= style.transition !== ''))
      const a = ctx.lazyEase({ loader: ctx.loader(), fadeDuration: 0 }).attach(img, { src: image.src, aspectRatio: 3 / 2, placeholder: image.color, ...metadata(image) })
      await ctx.expect('Reaches loaded', () => a.state === 'loaded')
      ctx.assert('No transition was set', !transition)
      ctx.assert('Image fully visible', img.style.opacity === '')
      ctx.readout('prefers-reduced-motion')(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference')
      stop()
    },
  },
  {
    id: 'ownership',
    group: 'Lifecycle',
    title: 'One owner per image',
    about: 'Two controllers, as from two copies of the package, cannot attach to the same image; after destroy() the other one can.',
    async run(ctx) {
      const image = landscape(ctx, 1)
      const { img } = ctx.box(ctx.stage, 'frame ratio-3-2')
      const loader = ctx.loader()
      const first = ctx.lazyEase({ loader }).attach(img, { src: image.src, aspectRatio: 3 / 2, ...metadata(image) })
      let message = ''
      try {
        ctx.lazyEase({ loader }).attach(img, { src: image.src, aspectRatio: 3 / 2 })
      } catch (error) {
        message = (error as Error).message
      }
      ctx.assert('Second attach throws', message.includes('already attached'), message)
      first.destroy()
      const second = ctx.lazyEase({ loader }).attach(img, { src: image.src, aspectRatio: 3 / 2, ...metadata(image) })
      await ctx.expect('Attaches after destroy() and loads', () => second.state === 'loaded')
    },
  },
  {
    id: 'when-visible',
    group: 'Lifecycle',
    title: 'whenVisible for decorative backgrounds',
    about: 'The primitive the controller uses, on its own: two subscriptions on one element both fire once it comes into view.',
    async run(ctx) {
      const { whenVisible } = await import('@lazy-ease/core')
      const image = landscape(ctx, 2)
      const s = scroller(ctx)
      const banner = document.createElement('div')
      banner.className = 'banner'
      banner.textContent = 'Decorative background'
      s.content.append(banner)
      const fired: string[] = []
      const url = ctx.loader().url({ src: image.src, width: 640, quality: 75, format: 'webp' })
      const stopA = whenVisible(banner, { root: s.root, rootMargin: '0px' }, () => {
        fired.push('background')
        banner.style.backgroundImage = `url("${url}")`
      })
      const stopB = whenVisible(banner, { root: s.root, rootMargin: '0px' }, () => fired.push('analytics'))
      await ctx.never('Nothing fires out of view', () => fired.length > 0, 1000)
      s.scrollIn()
      await ctx.expect('Both subscriptions fired', () => fired.includes('background') && fired.includes('analytics'))
      stopA()
      stopB()
    },
  },
]
