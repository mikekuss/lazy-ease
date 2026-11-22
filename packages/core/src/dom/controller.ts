import { normalizeFocalPoint, percentPosition, type FocalPoint } from '../focal.js'
import type { ImageLoader, ImageLoaderFunction } from '../loader.js'
import { isDirect } from '../source.js'
import { parsePlaceholder, type StyleRecord, type ThumbHashDecoder } from '../styles.js'
import { fades } from './fades.js'
import type { FormatDetector } from './format.js'
import { guard } from './guard.js'
import { observeResize, whenVisible } from './observe.js'
import type { Reveal } from './reveal.js'

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

/** Defaults for every image of an instance. */
export interface LazyEaseConfig {
  /** Builds the URLs of measured images, e.g. `createLoader()`. Required for `src` unless it loads directly. */
  loader?: ImageLoader | ImageLoaderFunction
  /** Hosts served by the loader besides relative paths. Other absolute URLs load directly. */
  domains?: readonly string[]
  /** Snapped to the nearest quality the loader allows. Default 75. */
  quality?: number
  /** The scrolling element deferred images are observed against. Default: the viewport. */
  root?: Element | Document | null
  /** How far outside the root to start loading, as a CSS margin. Default `'400px'`. */
  rootMargin?: string
  /** How long an image must stay in the preload zone before it loads, in ms. Default 0. */
  dwellTime?: number
  /** Crossfade in ms. 0 swaps directly, as does `prefers-reduced-motion`. Default 400. */
  fadeDuration?: number
  /** Keyframes for the fade instead of the crossfade, e.g. `focusReveal`. Default: none. */
  reveal?: Reveal
  /** How long a loaded image may take to decode before it is shown anyway, in ms. Default 250. */
  decodeTimeout?: number
  /** Enables `thumbhash:` placeholders; see `@lazy-ease/core/thumbhash`. */
  thumbhash?: ThumbHashDecoder
  /**
   * Picks the format of measured images when the loader declares several.
   * `detectAvif` requests AVIF where the browser decodes it. Default: the
   * best declared format other than AVIF, WebP first, or AVIF when it is
   * the only one. A detector that throws or rejects gets that default.
   */
  detectFormat?: FormatDetector
  /** Every state change of an attached image. */
  onStateChange?: (state: LoadState, img: HTMLImageElement) => void
}

/**
 * One logical image. Exactly one source mode: `src` (measured), `srcset`
 * and/or `url` (prepared), or `priority` / `loading: 'native'`, which adopt
 * the sources already in the HTML.
 */
export interface AttachOptions extends Pick<LazyEaseConfig, 'loader' | 'quality' | 'root' | 'rootMargin' | 'dwellTime' | 'fadeDuration' | 'reveal' | 'onStateChange'> {
  /** Logical source. The controller measures the slot and installs the loader's candidates. */
  src?: string
  /** Prepared candidate list, copied as is on activation. */
  srcset?: string
  /** Prepared slot for `srcset`. */
  sizes?: string
  /** Prepared single URL, or the fallback of a prepared list. */
  url?: string
  /** `'lazy'` (default) waits for visibility, `'eager'` activates at once, `'native'` adopts the HTML. */
  loading?: 'lazy' | 'eager' | 'native'
  /** Adopts the HTML like `'native'`, with eager loading, high fetch priority and no fade. */
  priority?: boolean
  /** Rendered width in CSS px; with `height`, a fixed box. */
  width?: number
  height?: number
  /** Box ratio, or with `fill` the crop ratio. */
  aspectRatio?: number
  /** The box fills its positioned parent. */
  fill?: boolean
  /** Who crops a fill image. Default: the browser when both source dimensions are known, else the server. */
  crop?: 'server' | 'browser'
  /** Oriented source width. */
  srcWidth?: number
  /** Oriented source height. */
  srcHeight?: number
  /** Point to keep in view, in percent of the source. */
  focalPoint?: FocalPoint
  /** Opaque revision passed to the loader. */
  version?: string
  /** Crop token passed to the loader, for a backend that signs crops. */
  token?: string
  /** A CSS color, a data URI, `thumbhash:<base64>` or `'none'`, painted on the box. Default: what the HTML has. */
  placeholder?: string
  /**
   * The placeholder the caller painted inline stands for a transparent image,
   * e.g. a decoded ThumbHash with alpha: it fades out during the fade instead
   * of staying under the image to the end. A `placeholder` says it itself.
   */
  transparent?: boolean
  /**
   * First display of this source, once: after a load and decode, or when an
   * already displayed image is adopted. `event` is the load event when one
   * was observed; adoption never fabricates one.
   */
  onDisplay?: (img: HTMLImageElement, event?: Event) => void
}

export interface Attachment {
  readonly state: LoadState
  /**
   * Starts a new generation for new options (a new logical source) with its
   * own placeholder. A native generation adopts the sources the element has
   * when `update` runs, so set them first. The same deferred source (src,
   * srcset, url, version and picture sources) keeps an image that has its
   * target, loading, loaded or failed, under the new options; one without it
   * starts over on the same placeholder.
   */
  update(options: AttachOptions): void
  /** Releases listeners, observers, timers and ownership. The element keeps what it displays. */
  destroy(): void
}

export interface LazyEase {
  /** The config the instance was created with. Adapters read root, margin and dwell time from it; do not change it. */
  readonly config: Readonly<LazyEaseConfig>
  /** Takes over one image, `img.closest('[data-le]')` being its box. Throws on invalid or ambiguous options before touching the element. */
  attach(img: HTMLImageElement, options?: AttachOptions): Attachment
}

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const PLACEHOLDER = ['backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition']
const FADE = ['opacity', 'transition']
const ATTRIBUTES = ['sizes', 'srcset', 'src']

/** Attach options over the instance's config over the defaults. */
export type Options = LazyEaseConfig & AttachOptions
export type Timer = ReturnType<typeof setTimeout>

export type Mode = 'fill' | 'fixed' | 'ratio' | 'intrinsic'

/**
 * Measured mode, for one generation: watches the slot of `src` and installs
 * the loader's candidates for it. Returns what removes the focal styles it
 * set. Positional, because an object of these costs bytes in every bundle.
 */
export type Measure = (
  src: string,
  o: Options,
  mode: Mode,
  /** The normalized focal point, for every mode but intrinsic. */
  focus: FocalPoint | undefined,
  img: HTMLImageElement,
  box: HTMLElement | undefined,
  /** The box, or the img without one: the element that is measured. */
  surface: HTMLElement,
  /** Whether the generation still runs. */
  live: () => boolean,
  /** A timeout the end of the generation clears. */
  later: (callback: () => void, ms: number) => Timer,
  /** Clears a timeout from `later` early. */
  cancel: (timer?: Timer) => void,
  /** Called when the generation ends. */
  cleanups: (() => void)[],
  /** Activates candidates: sizes, srcset and src, a missing src keeping the placeholder's. */
  install: (srcset?: string, sizes?: string, src?: string) => void,
) => () => void

// Camel-case properties, as StyleRecord has them; '' removes a declaration.
const styleOf = (element: HTMLElement) => element.style as unknown as Record<string, string>
const clearStyle = (element: HTMLElement, properties: readonly string[]) => {
  for (const property of properties) styleOf(element)[property] = ''
}
const isNative = (o: Options) => o.priority || o.loading === 'native'
/** The logical source of deferred options and picture sources: what an image displayed under them shows. */
const identity = (o: Options, sources: Iterable<Element>) =>
  JSON.stringify([o.src, o.srcset, o.url, o.version, ...[...sources].map((source) => source.getAttribute('data-le-srcset'))])

/**
 * A controller instance, with measured mode when `measure` is given;
 * `noSrc` is the error for a `src` it cannot load. Creating it does nothing:
 * observers and format detection start on first need. Several instances,
 * and several copies of the package, can share one page.
 */
export function createController(config: LazyEaseConfig, measure?: Measure, noSrc?: string): LazyEase {
  /** Attach options over the instance's config over the defaults, validated; with `img` (update) also against the observer. */
  const resolve = (options: AttachOptions, img?: HTMLImageElement): Options => {
    const o: Options = { rootMargin: '400px', fadeDuration: 400, decodeTimeout: 250, quality: 75, ...config }
    for (const key in options) {
      const value = options[key as keyof AttachOptions]
      if (value !== undefined) (o as Record<string, unknown>)[key] = value
    }
    const sources = +(o.src !== undefined) + +(o.srcset !== undefined || o.url !== undefined)
    const focus = o.focalPoint
    const problem =
      (isNative(o) ? sources : sources - 1)
        ? 'needs exactly one of src, srcset/url or native'
        : o.sizes !== undefined && o.srcset === undefined
          ? 'sizes needs srcset'
          : o.src !== undefined && !(measure && o.loader) && !isDirect(o.src, o.domains)
            ? noSrc!
            : o.height !== undefined && (o.width === undefined || o.aspectRatio !== undefined)
              ? 'height needs width and no aspectRatio'
              : o.fill && (o.width ?? o.height) !== undefined
                ? 'fill excludes width and height'
                : o.crop === 'browser' && !(o.srcWidth && o.srcHeight)
                  ? 'browser crop needs srcWidth and srcHeight'
                  : focus && !(isFinite(focus.x) && isFinite(focus.y))
                    ? 'focalPoint needs finite x and y'
                    : o.placeholder !== undefined && !parsePlaceholder(o.placeholder, o.thumbhash)
                      ? 'invalid placeholder'
                      : ''
    if (problem) throw new TypeError(`[lazy-ease] ${problem}`)
    // What the next generation could still reject, found before update() ends the current one: a root or margin
    // the IntersectionObserver refuses. A subscription made and cancelled at once builds the observer.
    if (img && !isNative(o) && o.loading !== 'eager') whenVisible(img, o, () => {})()
    return o
  }

  return {
    config,
    attach(img, options = {}) {
      let o = resolve(options)
      // Global, so every copy of the package on the page sees the claim.
      const key = Symbol.for('lazy-ease.attachment')
      const claims = img as unknown as Record<symbol, object | undefined>
      if (claims[key]) throw new Error('[lazy-ease] The image is already attached')
      const claim = (claims[key] = {})
      // The logical source whose target the element has, with the src it wrote and the
      // placeholder src it replaced, recorded when it is installed or adopted, kept past
      // destroy and removed when the element goes back to its placeholder.
      const targetKey = Symbol.for('lazy-ease.target')
      const targets = img as unknown as Record<symbol, [string, string | null | undefined, string] | undefined>

      const owner = img.closest<HTMLElement>('[data-le]') ?? img
      const box = owner === img ? undefined : owner
      // The box, or the img without one: the element that is painted, measured and observed.
      const surface = owner
      const attribute = (name: string) => img.getAttribute(name)
      const initialSrc = attribute('src')
      // A data: src is the placeholder, unless an earlier attachment set it as the target;
      // then the placeholder is the one that target replaced.
      const inert =
        initialSrc?.startsWith('data:') && initialSrc !== targets[targetKey]?.[1] ? initialSrc : (targets[targetKey]?.[2] ?? INERT)
      const deferredSources = () =>
        img.parentElement?.tagName === 'PICTURE' ? [...img.parentElement.querySelectorAll(':scope>source[data-le-srcset]')] : []
      const painted = PLACEHOLDER.map((property) => styleOf(surface)[property]!)
      // Back to the styles the element had before the first generation.
      const unpaint = () => {
        clearStyle(img, FADE)
        PLACEHOLDER.forEach((property, i) => (styleOf(surface)[property] = painted[i]!))
      }
      const snapshot = (element: Element = img) => ATTRIBUTES.map((name) => element.getAttribute(name))
      // In this order: sizes before srcset, or the browser selects for 100vw first.
      const restore = (values: (string | null | undefined)[], element: Element = img) =>
        ATTRIBUTES.forEach((name, i) => {
          const value = values[i]
          if (value == null) element.removeAttribute(name)
          else if (element.getAttribute(name) !== value) element.setAttribute(name, value)
        })
      let state: LoadState | undefined
      // Ends the generation, or keeps it under options of the same source and returns them.
      let stop: ((next?: Options) => unknown) | undefined

      const report = (next: LoadState) => {
        if (state === next) return
        state = next
        owner.setAttribute('data-state', next)
        guard(o.onStateChange, next, img)
      }

      const prior = owner.getAttribute('data-state')
      /** Ends the generation and gives up the element. */
      const destroy = () => {
        stop?.()
        stop = undefined
        if (claims[key] === claim) delete claims[key]
      }
      /**
       * One generation: everything that belongs to one logical source. Sets `stop` to its cleanup. If it throws,
       * the element is released as it was, so a later attach can take it, unless the ThumbHash decoder ended the
       * generation before it threw: then the element belongs to the next one, and only the error goes on. The
       * callbacks called through `guard` never throw into it.
       */
      const run = () => {
        const deferred = deferredSources()
        const before = [img, ...deferred].map((element) => [element, snapshot(element)] as const)
        const recorded = targets[targetKey]
        let live = true
        try {
          const native = isNative(o)
          // A native data: URI is the target; only the inert pixel is a placeholder there.
          const placeholderSrc = native ? INERT : inert
          const src = attribute('src')
          let own = img.hasAttribute('srcset') || (native ? (src ?? INERT) !== INERT : src != null && (src === recorded?.[1] || !src.startsWith('data:')))
          const target = native ? undefined : identity(o, deferred)
          // The element still has the target of an earlier attachment for another source:
          // back to the placeholder, so the old image is neither adopted nor shown.
          if (own && target && recorded && recorded[0] !== target) {
            restore([null, null, inert])
            for (const source of deferred) {
              source.removeAttribute('srcset')
              if (source.hasAttribute('data-le-sizes')) source.removeAttribute('sizes')
            }
            own = false
          }
          // An adopted target is this source's; a native one is nobody's.
          // A data: src next to an adopted srcset is the placeholder, unless the target set it.
          targets[targetKey] = own && target ? [target, src?.startsWith('data:') && src !== recorded?.[1] ? undefined : src, inert] : undefined
          // A native source is the element's own, whenever it is set.
          let assigned = native || own
          let shown = false
          let hidden = false
          let good: (string | null)[] | undefined
          let fade: Animation | undefined
          let fadeOut: Animation | undefined
          // The reveal's animation, once it runs.
          let revealed: Animation | undefined
          // The <source> elements this generation activated, with their attributes from before.
          const activated = new Map<Element, (string | null)[]>()
          let unfocus = () => {}
          const timers = new Set<Timer>()
          const cleanups: (() => void)[] = []
          const later = (callback: () => void, ms: number) => {
            const timer = setTimeout(() => {
              timers.delete(timer)
              callback()
            }, ms)
            timers.add(timer)
            return timer
          }
          const cancel = (timer?: Timer) => {
            clearTimeout(timer)
            timers.delete(timer!)
          }
          const on = (type: string, listener: (event: Event) => void) => {
            img.addEventListener(type, listener)
            cleanups.push(() => img.removeEventListener(type, listener))
          }
          const fadeMs = o.fadeDuration!
          // Until `end` is the cleanup: a decoder that updates or destroys the image ends this generation too.
          stop = () => (live = false)
          // resolve() refused an empty or invalid placeholder.
          const placeholder = o.placeholder ? parsePlaceholder(o.placeholder, o.thumbhash) : undefined
          if (!live) return
          const mode: Mode = o.fill ? 'fill' : o.height !== undefined ? 'fixed' : o.aspectRatio !== undefined ? 'ratio' : 'intrinsic'
          const focus = mode === 'intrinsic' ? undefined : normalizeFocalPoint(o.focalPoint)
          const paint = (style: StyleRecord) => {
            clearStyle(surface, PLACEHOLDER)
            Object.assign(surface.style, focus && style.backgroundImage ? { ...style, backgroundPosition: percentPosition(focus) } : style)
          }
          if (placeholder) paint(placeholder.style)
          // No fade: none set, or reduced motion.
          const still = () => fadeMs <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches
          // The box size for a reveal, without a layout read at display: watched until the first display.
          let edge = 0
          let unwatch = () => {}

          // Shows the image and removes the placeholder, so transparent images don't show it. Ends a fade cut short.
          const release = () => {
            fade?.cancel()
            if (fades) fadeOut?.cancel()
            clearStyle(img, FADE)
            clearStyle(surface, PLACEHOLDER)
          }
          const display = (event?: Event) => {
            shown = true
            if (fades) unwatch()
            good = snapshot()
            report('loaded')
            // A callback above or below can update() or destroy(): then the element belongs to the next generation,
            // and this generation's onDisplay doesn't run.
            if (!live) return
            if (img.style.opacity !== '0' || still()) release()
            else {
              // No style or layout flush (spec): an opacity 0 set in this frame is no start value for the transition,
              // so the animation's keyframes give the fade its start. Where it runs, the transition shows the same fade.
              // Without Web Animations (jsdom) only the transition is left.
              if (fades && o.reveal) {
                // A reveal that throws gets the plain fade.
                const keyframes = guard(o.reveal, edge)
                if (!live) return
                if (keyframes) revealed = fade = img.animate?.(keyframes, fadeMs)
              }
              if (!(fades && revealed)) fade = img.animate?.({ opacity: [0, 1], easing: 'ease-out' }, fadeMs)
              Object.assign(img.style, { transition: `opacity ${fadeMs}ms ease-out`, opacity: '1' })
              // A placeholder known to stand for a transparent image (a ThumbHash with alpha, or `transparent`)
              // fades out while the image becomes opaque, from 40 to 80 % of the fade, or 25 to 60 % with a
              // reveal that runs (`focusReveal` is opaque at 45 %), so the image crossfades instead of losing it
              // at once at the end. Any other stays to the end, under the edges a blurring reveal leaves translucent.
              // Only what is painted inline fades: release() clears that, so it does not come back, while a
              // background from the author's CSS stays. Browsers that don't interpolate background images
              // (Firefox) drop the image half way through.
              if (fades && (placeholder ?? o).transparent) {
                const [from, to] = revealed ? [0.25, 0.6] : [0.4, 0.8]
                const { backgroundImage, backgroundColor } = surface.style
                fadeOut = surface.animate?.(
                  { ...(backgroundImage && { backgroundImage: `url(${INERT})` }), ...(backgroundColor && { backgroundColor: 'transparent' }) },
                  { duration: (to - from) * fadeMs, delay: from * fadeMs, fill: 'forwards' },
                )
              }
              later(release, fadeMs)
            }
            guard(o.onDisplay, img, event)
          }
          const fail = () => {
            // The alt text or the browser's broken-image presentation, in the reserved area. As at the display,
            // the box edge is no longer watched. Before the report, whose callback can end the generation.
            if (fades) unwatch()
            release()
            report('error')
          }

          on('load', (event) => {
            // The inert placeholder's own load says nothing about the target.
            if (!assigned || img.currentSrc === placeholderSrc) return
            if (shown) good = snapshot()
            else if (native) display(event)
            else {
              const expected = img.currentSrc
              // The decode or its timeout, whichever settles first.
              void new Promise<boolean>((resolve) => {
                img.decode().then(
                  () => resolve(true),
                  () => resolve(false),
                )
                later(() => resolve(true), o.decodeTimeout!)
              }).then((ok) => {
                // A newer source is on its way, or this generation is over.
                if (!live || shown || img.currentSrc !== expected) return
                if (ok) display(event)
                else fail()
              })
            }
          })
          on('error', () => {
            if (!assigned) return
            // A failed upgrade keeps the image that is displayed.
            if (!shown) fail()
            else if (good && snapshot().some((value, i) => value !== good![i])) restore(good)
          })

          const install = (srcset?: string, sizes?: string, src?: string) => {
            const values = [srcset && sizes, srcset, src ?? attribute('src')]
            // Only a src the target writes is its own: a srcset alone leaves the placeholder src.
            targets[targetKey] = [target!, src, inert]
            // An adopted error of this very source stays one: writing nothing brings no new event.
            if (state === 'error' && img.parentElement?.tagName !== 'PICTURE' && snapshot().every((value, i) => value === (values[i] ?? null))) return
            // Hidden before the target is assigned, so neither a partial image nor the alt text flashes.
            if (!assigned && box) {
              img.style.opacity = '0'
              hidden = true
            }
            assigned = true
            // An upgrade keeps the loaded state; the displayed image stays.
            if (!shown) report('loading')
            if (!live) return
            for (const source of deferredSources()) {
              if (!activated.has(source)) activated.set(source, snapshot(source))
              const deferred = source.getAttribute('data-le-sizes')
              if (deferred !== null) source.setAttribute('sizes', deferred)
              source.setAttribute('srcset', source.getAttribute('data-le-srcset')!)
            }
            restore(values)
          }

          const activate = () => {
            if (placeholder?.lazy && !shown) {
              // The decoder can update() or destroy(); one that throws leaves the color.
              const style = guard(placeholder.lazy)
              if (!live) return
              if (style) paint(style)
            }
            if (o.src === undefined) install(o.srcset, o.sizes, o.url)
            else if (isDirect(o.src, o.domains)) install(undefined, undefined, o.src)
            else unfocus = measure!(o.src, o, mode, focus, img, box, surface, () => live, later, cancel, cleanups, install)
          }

          const end = (next?: Options) => {
            // The same source keeps an image that has its target, loading, loaded or failed, under the new options.
            if (next && assigned && identity(next, deferredSources()) === target) return (o = next)
            live = false
            cleanups.forEach((cleanup) => cleanup())
            timers.forEach(clearTimeout)
            // A fade cut short ends here, so the placeholder does not stay behind the image.
            if (shown) release()
            // A target still loading shows when it arrives, over the placeholder.
            else if (hidden) clearStyle(img, FADE)
            if (!next) return
            unfocus()
            // Back to the placeholder: the old target must not show under the new source.
            // A native source is what the element has when the update runs.
            if (!isNative(next)) {
              restore([null, null, inert])
              targets[targetKey] = undefined
              activated.forEach((values, source) => restore(values, source))
            }
          }

          // Before the first report and what can throw, so that a callback's destroy() and update() end this generation.
          stop = end
          // Adoption: an image that already has its target is not reloaded.
          if (own && img.complete) {
            if (img.naturalWidth > 0) display()
            else fail()
          } else report(own ? 'loading' : 'idle')
          // A callback above destroyed or updated the image.
          if (!live) return
          // Not for an image displayed or failed at adoption, which reveals nothing.
          if (fades && o.reveal && box && !native && !(own && img.complete) && !still())
            cleanups.push((unwatch = observeResize(box, (width, height) => (edge = width > height ? width : height))))
          if (native) {
            if (o.priority) {
              img.setAttribute('fetchpriority', 'high')
              img.setAttribute('loading', 'eager')
            }
          } else if (o.loading === 'eager') activate()
          // Throws when there is no IntersectionObserver for this root and margin.
          else cleanups.push(whenVisible(surface, o, activate))
        } catch (error) {
          if (!live) throw error
          destroy()
          before.forEach(([element, values]) => restore(values, element))
          targets[targetKey] = recorded
          unpaint()
          if (prior === null) owner.removeAttribute('data-state')
          else owner.setAttribute('data-state', prior)
          throw error
        }
      }
      run()
      return {
        get state() {
          return state!
        },
        update(next) {
          const resolved = resolve(next, img)
          if (!stop || stop(resolved)) return
          unpaint()
          o = resolved
          run()
        },
        destroy,
      }
    },
  }
}
