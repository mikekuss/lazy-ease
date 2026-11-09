import { candidateSet } from '../candidates.js'
import { normalizeFocalPoint, percentPosition, type FocalPoint } from '../focal.js'
import { normalizeLoader, snapQuality, type ImageFormat, type ImageLoader, type ImageLoaderFunction } from '../loader.js'
import { snapRatio } from '../ratios.js'
import { isDirect } from '../source.js'
import { focusStyles, parsePlaceholder, type StyleRecord, type ThumbHashDecoder } from '../styles.js'
import { measuredCandidates, snapWidth } from '../widths.js'
import { chooseFormat } from './format.js'
import { observeResize, whenVisible } from './observe.js'

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
  /** How long a loaded image may take to decode before it is shown anyway, in ms. Default 250. */
  decodeTimeout?: number
  /** Enables `thumbhash:` placeholders; see `@lazy-ease/core/thumbhash`. */
  thumbhash?: ThumbHashDecoder
  /** Every state change of an attached image. */
  onStateChange?: (state: LoadState, img: HTMLImageElement) => void
}

/**
 * One logical image. Exactly one source mode: `src` (measured), `srcset`
 * and/or `url` (prepared), or `priority` / `loading: 'native'`, which adopt
 * the sources already in the HTML.
 */
export interface AttachOptions extends Pick<LazyEaseConfig, 'loader' | 'quality' | 'root' | 'rootMargin' | 'dwellTime' | 'fadeDuration' | 'onStateChange'> {
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
   * when `update` runs, so set them first.
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

type Options = LazyEaseConfig & AttachOptions
type Timer = ReturnType<typeof setTimeout>

// Camel-case properties, as StyleRecord has them; '' removes a declaration.
const styleOf = (element: HTMLElement) => element.style as unknown as Record<string, string>
const clearStyle = (element: HTMLElement, properties: readonly string[]) => {
  for (const property of properties) styleOf(element)[property] = ''
}
/** Sets `styles` on `element` and returns what puts the replaced values back. */
const assign = (element: HTMLElement, styles: StyleRecord) => {
  const before: Record<string, string> = {}
  for (const property in styles) before[property] = styleOf(element)[property]!
  Object.assign(element.style, styles)
  return () => Object.assign(element.style, before)
}
const isNative = (o: Options) => o.priority || o.loading === 'native'

/**
 * A controller instance. Creating it does nothing: observers and format
 * detection start on first need. Several instances, and several copies of
 * the package, can share one page.
 */
export function createLazyEase(config: LazyEaseConfig = {}): LazyEase {
  /** Attach options over the instance's config over the defaults, validated. */
  const resolve = (options: AttachOptions): Options => {
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
          : o.src !== undefined && !o.loader && !isDirect(o.src, o.domains)
            ? 'src needs a loader'
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

      const owner = img.closest<HTMLElement>('[data-le]') ?? img
      const box = owner === img ? undefined : owner
      const surface = box ?? img
      const attribute = (name: string) => img.getAttribute(name)
      const initialSrc = attribute('src')
      const inert = initialSrc?.startsWith('data:') ? initialSrc : INERT
      const painted = PLACEHOLDER.map((property) => styleOf(surface)[property]!)
      const snapshot = (element: Element = img) => ATTRIBUTES.map((name) => element.getAttribute(name))
      // In this order: sizes before srcset, or the browser selects for 100vw first.
      const restore = (values: (string | null | undefined)[], element: Element = img) =>
        ATTRIBUTES.forEach((name, i) => {
          const value = values[i]
          if (value == null) element.removeAttribute(name)
          else if (element.getAttribute(name) !== value) element.setAttribute(name, value)
        })
      let state: LoadState | undefined
      let stop: ((next?: Options) => void) | undefined

      const report = (next: LoadState) => {
        if (state === next) return
        state = next
        owner.setAttribute('data-state', next)
        o.onStateChange?.(next, img)
      }

      /** One generation: everything that belongs to one logical source. Returns its cleanup. */
      const run = (): ((next?: Options) => void) => {
        const native = isNative(o)
        const own = img.hasAttribute('srcset') || !(attribute('src') ?? 'data:').startsWith('data:')
        let live = true
        // A native source is the element's own, whenever it is set.
        let assigned = native || own
        let shown = false
        let hidden = false
        let good: (string | null)[] | undefined
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
        const on = (type: string, listener: (event: Event) => void) => {
          img.addEventListener(type, listener)
          cleanups.push(() => img.removeEventListener(type, listener))
        }
        const fadeMs = o.fadeDuration!
        const placeholder = o.placeholder === undefined ? undefined : parsePlaceholder(o.placeholder, o.thumbhash)
        const mode = o.fill ? 'fill' : o.height !== undefined ? 'fixed' : o.aspectRatio !== undefined ? 'ratio' : 'intrinsic'
        const focus = mode === 'intrinsic' ? undefined : normalizeFocalPoint(o.focalPoint)
        const paint = (style: StyleRecord) => {
          clearStyle(surface, PLACEHOLDER)
          Object.assign(surface.style, focus && style.backgroundImage ? { ...style, backgroundPosition: percentPosition(focus) } : style)
        }
        if (placeholder) paint(placeholder.style)

        // Shows the image and removes the placeholder, so transparent images don't show it.
        const release = () => {
          clearStyle(img, FADE)
          clearStyle(surface, PLACEHOLDER)
        }
        const display = (event?: Event) => {
          shown = true
          good = snapshot()
          report('loaded')
          if (img.style.opacity !== '0' || fadeMs <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) release()
          else {
            Object.assign(img.style, { transition: `opacity ${fadeMs}ms ease-out`, opacity: '1' })
            later(release, fadeMs)
          }
          o.onDisplay?.(img, event)
        }
        const fail = () => {
          report('error')
          // The alt text or the browser's broken-image presentation, in the reserved area.
          release()
        }

        on('load', (event) => {
          // The inert placeholder's own load says nothing about the target.
          if (!assigned || img.currentSrc === inert) return
          if (shown) good = snapshot()
          else if (native) display(event)
          else {
            const expected = img.currentSrc
            void Promise.race([
              img.decode().then(
                () => true,
                () => false,
              ),
              new Promise<boolean>((resolve) => later(() => resolve(true), o.decodeTimeout!)),
            ]).then((ok) => {
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
          // An adopted error of this very source stays one: writing nothing brings no new event.
          const picture = img.parentElement
          if (state === 'error' && picture?.tagName !== 'PICTURE' && snapshot().every((value, i) => value === (values[i] ?? null))) return
          // Hidden before the target is assigned, so neither a partial image nor the alt text flashes.
          if (!assigned && box) {
            img.style.opacity = '0'
            hidden = true
          }
          assigned = true
          // An upgrade keeps the loaded state; the displayed image stays.
          if (!shown) report('loading')
          if (picture?.tagName === 'PICTURE') {
            for (const source of picture.querySelectorAll(':scope>source[data-le-srcset]')) {
              if (!activated.has(source)) activated.set(source, snapshot(source))
              const deferred = source.getAttribute('data-le-sizes')
              if (deferred !== null) source.setAttribute('sizes', deferred)
              source.setAttribute('srcset', source.getAttribute('data-le-srcset')!)
            }
          }
          restore(values)
        }

        const measure = (src: string) => {
          const loader = normalizeLoader(o.loader!)
          const quality = snapQuality(o.quality!, loader.qualities)
          const { srcWidth, srcHeight } = o
          const declared = mode === 'fixed' ? o.width! / o.height! : o.aspectRatio
          const sourceRatio = srcWidth && srcHeight ? srcWidth / srcHeight : undefined
          const browserCrop =
            mode !== 'intrinsic' && (o.crop ? o.crop === 'browser' : mode === 'fill' && declared === undefined && !!sourceRatio)
          const candidates = (slot: number) => measuredCandidates({ measuredWidth: slot, ladder: loader.widths, srcWidth })
          // The candidate a browser at this DPR takes for a slot.
          const selected = (slot: number) => Math.min(snapWidth(slot * (devicePixelRatio || 1), loader.widths), candidates(slot).at(-1)!)
          let current: { slot: number; ratio?: number } | undefined
          let format: ImageFormat | 'auto'
          let timer: Timer | undefined

          const resize = (width: number, height: number) => {
            // Hidden or collapsed slots stay as they are until they get a size.
            if (!live || !(width > 0) || (mode === 'fill' && !(height > 0))) return
            // Without a declared ratio a server-cropped fill takes the box's.
            const ratio = browserCrop || mode === 'intrinsic' ? undefined : snapRatio(declared ?? width / height, loader.ratios)
            const served = browserCrop ? sourceRatio : ratio
            // The cover width: the image is wider than the box when the box is relatively taller.
            let slot = Math.ceil(served ? Math.max(width, height * served) : width)
            if (current) {
              if (ratio === current.ratio && !(slot > current.slot && selected(slot) > selected(current.slot))) return
              slot = Math.max(slot, current.slot)
            }
            current = { slot, ratio }
            const set = candidateSet({
              widths: candidates(slot),
              srcWidth,
              srcHeight,
              loader,
              src,
              aspectRatio: ratio,
              focalPoint: ratio ? focus : undefined,
              quality,
              format,
              version: o.version,
              token: o.token,
            })
            if (focus) {
              // A re-measure replaces the previous crop’s styles.
              unfocus()
              const styles = focusStyles({ focus, crop: ratio, srcWidth, srcHeight })
              const undo = [assign(img, styles.img), box && assign(box, styles.box)]
              unfocus = () => undo.forEach((callback) => callback?.())
            }
            install(set.srcset, `${slot}px`, set.srcset ? undefined : set.src)
          }

          const start = (chosen: ImageFormat | 'auto') => {
            if (!live) return
            format = chosen
            cleanups.push(
              observeResize(surface, (width, height) => {
                // The first size counts at once; later ones once a resize settles.
                if (!current) return resize(width, height)
                clearTimeout(timer)
                timers.delete(timer!)
                timer = later(() => resize(width, height), 200)
              }),
            )
          }
          const chosen = chooseFormat(loader.formats)
          if (typeof chosen == 'string') start(chosen)
          else void chosen.then(start)
        }

        const activate = () => {
          if (placeholder?.lazy && !shown) paint(placeholder.lazy())
          if (o.src === undefined) install(o.srcset, o.sizes, o.url)
          else if (isDirect(o.src, o.domains)) install(undefined, undefined, o.src)
          else measure(o.src)
        }

        // Adoption: an image that already has its target is not reloaded.
        if (own && img.complete) {
          if (img.naturalWidth > 0) display()
          else fail()
        } else report(own ? 'loading' : 'idle')

        if (native) {
          if (o.priority) {
            img.setAttribute('fetchpriority', 'high')
            img.setAttribute('loading', 'eager')
          }
        } else if (o.loading === 'eager') activate()
        else cleanups.push(whenVisible(surface, o, activate))

        return (next) => {
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
            activated.forEach((values, source) => restore(values, source))
          }
        }
      }

      stop = run()
      return {
        get state() {
          return state!
        },
        update(next) {
          const resolved = resolve(next)
          if (!stop) return
          stop(resolved)
          clearStyle(img, FADE)
          PLACEHOLDER.forEach((property, i) => (styleOf(surface)[property] = painted[i]!))
          o = resolved
          stop = run()
        },
        destroy() {
          stop?.()
          stop = undefined
          if (claims[key] === claim) delete claims[key]
        },
      }
    },
  }
}
