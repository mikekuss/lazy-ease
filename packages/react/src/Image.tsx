import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type Ref,
  type SyntheticEvent,
} from 'react'
import { preload } from 'react-dom'
import { useLazyEaseConfig, type LoadingStrategy } from './context.js'
import { DEV, warnOnce } from './dev.js'
import { detectFormat, resolvedFormat } from './format.js'
import { invalidCombination, resolveLayout } from './layout.js'
import {
  normalizeLoader,
  snapQuality,
  type ImageFormat,
  type ImageLoader,
  type ImageLoaderFunction,
  type ResolvedLoader,
} from './loader.js'
import { observeResize, whenVisible } from './observer.js'
import { isOwned } from './owned.js'
import { parsePlaceholder, thumbhashImageStyle, type Placeholder, type PlaceholderStyle } from './placeholder.js'
import { snapRatio } from './ratios.js'
import { buildSrcSet } from './srcset.js'
import { classicCandidates, fullLadder, measuredCandidates, snapWidth } from './widths.js'

export interface ImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'sizes' | 'width' | 'height' | 'loading' | 'placeholder'> {
  src: string
  alt: string
  /** Rendered width in CSS px. */
  width?: number
  /** Rendered height in CSS px. Only valid together with `width` (fixed mode). */
  height?: number
  /** Box ratio in ratio mode. In fill mode, the crop ratio sent to the backend. */
  aspectRatio?: number
  /** The box fills its positioned parent. */
  fill?: boolean
  /** Classic `sizes`. Turns off measuring (classic mode). */
  sizes?: string
  /** Intrinsic width of the source. Ladder widths above it are not offered. */
  srcWidth?: number
  /** Intrinsic height of the source. */
  srcHeight?: number
  /** Opaque cache-busting token passed to the loader. */
  version?: string
  /** Snapped to the nearest quality the loader allows. */
  quality?: number
  loading?: LoadingStrategy
  /** Preload distance for `loading="lazy"`. */
  rootMargin?: string
  /** Eager, `fetchpriority="high"` and a preload link. For the LCP image only. */
  priority?: boolean
  /** A CSS color, a data URI, `thumbhash:<base64>` or `'none'`. */
  placeholder?: string
  /** Crossfade in ms for measured-mode images. */
  fadeDuration?: number
  /** Forces external-image behavior: `src` as is, no srcset. */
  unoptimized?: boolean
  loader?: ImageLoader | ImageLoaderFunction
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
  /** Forwarded to the `<img>`. */
  ref?: Ref<HTMLImageElement>
}

type Status = 'loaded' | 'error'

/** What the box has measured: `width` is the value written to `sizes`. */
interface Measure {
  width: number
  /** Snapped box ratio, tracked only in fill mode without `aspectRatio`. */
  ratio?: number
}

interface MeasureOptions {
  ladder: readonly number[]
  ratios: readonly number[]
  srcWidth?: number
  trackRatio: boolean
}

const DECODE_TIMEOUT = 250
const SIZES_DEBOUNCE = 200
const THUMBHASH_PREFIX = 'thumbhash:'
const BROWSER_PREFERENCE: readonly ImageFormat[] = ['avif', 'webp', 'jpeg']

/** The best format both the browser (`best` and anything older) and the loader support. */
function pickFormat(best: ImageFormat, formats: readonly ImageFormat[]): ImageFormat {
  const supported = BROWSER_PREFERENCE.slice(BROWSER_PREFERENCE.indexOf(best))
  return supported.find((format) => formats.includes(format)) ?? formats[0] ?? best
}

function firstMeasure(box: Pick<DOMRectReadOnly, 'width' | 'height'>, { ratios, trackRatio }: MeasureOptions): Measure {
  return {
    width: Math.ceil(box.width),
    ratio: trackRatio && box.height > 0 ? snapRatio(box.width / box.height, ratios) : undefined,
  }
}

/** The candidate a browser at `dpr` takes from the measured srcset for `width`. */
function selectedWidth(width: number, dpr: number, { ladder, srcWidth }: MeasureOptions): number {
  const candidates = measuredCandidates({ measuredWidth: width, ladder, srcWidth })
  return Math.min(snapWidth(width * dpr, ladder), candidates[candidates.length - 1]!)
}

/**
 * The measure after a resize (spec 6.2 steps 4 and 5). `sizes` only grows,
 * and only when the browser would pick another candidate; the ratio follows
 * the box when it moves to another ladder value.
 */
function grow(current: Measure, box: Pick<DOMRectReadOnly, 'width' | 'height'>, dpr: number, options: MeasureOptions): Measure {
  let next = current
  if (box.width > current.width && selectedWidth(box.width, dpr, options) > selectedWidth(current.width, dpr, options)) {
    next = { ...next, width: Math.ceil(box.width) }
  }
  if (options.trackRatio && box.width > 0 && box.height > 0) {
    const ratio = snapRatio(box.width / box.height, options.ratios)
    if (ratio !== current.ratio) next = { ...next, ratio }
  }
  return next
}

/** The format for URLs in the server HTML (spec 6.4): WebP, since nothing can be detected yet. */
function serverFormat(loader: ResolvedLoader): ImageFormat | 'auto' {
  return loader.formats === 'auto' ? 'auto' : pickFormat('webp', loader.formats)
}

interface ClassicSources {
  src: string
  srcSet: string
  sizes: string
}

interface ClassicSourcesOptions {
  src: string
  loader: ResolvedLoader
  width?: number
  sizes?: string
  srcWidth?: number
  crop?: number
  quality: number
  version?: string
}

/**
 * The URLs a classic-mode image carries in the server HTML (spec 6.3). The
 * priority preload is built from the same strings, so React dedupes it with
 * the `<img>` (spec 7.1).
 */
function classicSources({ src, loader, width, sizes, srcWidth, crop, quality, version }: ClassicSourcesOptions): ClassicSources {
  const widths =
    sizes !== undefined || width === undefined
      ? fullLadder({ ladder: loader.widths, srcWidth })
      : classicCandidates({ width, ladder: loader.widths, srcWidth })
  const request = { src, aspectRatio: crop, quality, format: serverFormat(loader), version }
  return {
    src: loader.url({ ...request, width: widths[Math.floor(widths.length / 2)]! }),
    srcSet: buildSrcSet({ ...request, widths, loader }),
    // Without either (a development error), the no-JS fallback's sizes.
    sizes: sizes ?? (width === undefined ? '100vw' : `${width}px`),
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function inViewport(rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  )
}

interface ResolvedPlaceholder {
  placeholder: Placeholder
  /** The string it was parsed from. */
  value: string
  /** Why the `placeholder` prop was rejected, if it was. */
  invalid?: string
}

function resolvePlaceholder(value: string, fallback: string): ResolvedPlaceholder {
  const placeholder = parsePlaceholder(value)
  if (placeholder.kind !== 'invalid') return { placeholder, value }
  const fallbackPlaceholder = parsePlaceholder(fallback)
  return {
    placeholder: fallbackPlaceholder.kind === 'invalid' ? { kind: 'none', ssrStyle: {} } : fallbackPlaceholder,
    value: fallback,
    invalid: placeholder.reason,
  }
}

/**
 * An image that loads at the size it is rendered at, behind an inline
 * placeholder (spec 5).
 */
export function Image(props: ImageProps) {
  // A new src starts over from `idle` with the placeholder (spec 5.1).
  return <ImageBox key={props.src} {...props} />
}

function ImageBox({
  src,
  alt,
  width,
  height,
  aspectRatio,
  fill = false,
  sizes,
  srcWidth,
  srcHeight,
  version,
  quality,
  loading,
  rootMargin,
  priority = false,
  placeholder,
  fadeDuration,
  unoptimized = false,
  loader: loaderProp,
  wrapperClassName,
  wrapperStyle,
  className,
  style,
  onLoad,
  onError,
  decoding = 'async',
  ref,
  ...imgProps
}: ImageProps) {
  const config = useLazyEaseConfig()
  const strategy = loading ?? config.loading

  if (DEV) {
    const problem = invalidCombination({ fill, width, height, aspectRatio, sizes, priority, loading: strategy })
    if (problem) throw new Error(`[lazy-ease] ${problem} (src: ${src})`)
  }

  const layout = useMemo(() => resolveLayout({ fill, width, height, aspectRatio }), [fill, width, height, aspectRatio])
  const owned = !unoptimized && isOwned(src, config.domains)
  const loader = owned && loaderProp ? normalizeLoader(loaderProp) : config.loader
  const q = snapQuality(quality ?? config.quality, loader.qualities)
  const classic = sizes !== undefined || priority || strategy === 'native'
  const eager = priority || strategy === 'eager'
  const margin = rootMargin ?? config.rootMargin
  const fadeMs = fadeDuration ?? config.fadeDuration
  const trackRatio = layout.mode === 'fill' && aspectRatio === undefined
  const crop = layout.declaredRatio === undefined ? undefined : snapRatio(layout.declaredRatio, loader.ratios)

  const resolved = useMemo(
    () => resolvePlaceholder(placeholder ?? config.placeholder, config.placeholder),
    [placeholder, config.placeholder],
  )

  const boxRef = useRef<HTMLSpanElement>(null)
  const [triggered, setTriggered] = useState(false)
  const [measure, setMeasure] = useState<Measure>()
  const [format, setFormat] = useState<ImageFormat | 'auto'>()
  const [status, setStatus] = useState<Status>()
  // The fade duration, once the image is revealed.
  const [fadeIn, setFadeIn] = useState<number>()
  const [fadeDone, setFadeDone] = useState(false)
  const [mounted, setMounted] = useState(false)
  const revealed = useRef(false)
  const alive = useRef(true)
  const latest = useRef({ fadeMs, onLoad })

  useLayoutEffect(() => {
    latest.current = { fadeMs, onLoad }
  })

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Mount-time development checks.
  useEffect(() => {
    if (!DEV) return
    if (resolved.invalid) {
      warnOnce(`placeholder:${src}`, `Invalid placeholder for ${src}: ${resolved.invalid}. Using the provider default.`)
    }
    if (layout.mode === 'intrinsic') {
      warnOnce(
        `intrinsic:${src}`,
        `${src} has no height to reserve and will shift the layout when it loads. Add \`height\`, \`aspectRatio\` or \`fill\`.`,
      )
    }
    if (loaderProp && !owned) {
      warnOnce(`loader:${src}`, `${src} is an external image, so its \`loader\` prop is ignored.`)
    }
    const box = boxRef.current
    if (owned && !classic && box && inViewport(box.getBoundingClientRect())) {
      warnOnce(
        `viewport:${src}`,
        `${src} is in the first viewport but waits for hydration and measuring. Set \`sizes\` or \`priority\` so its URL is in the server HTML.`,
      )
    }
    // Checks the props the image mounted with; later changes are not re-checked.
  }, [])

  // Measured-mode images decode their ThumbHash once triggered (spec 8);
  // classic ones, which may load any time, right after hydration.
  useEffect(() => {
    if (resolved.placeholder.kind === 'thumbhash' && classic) setMounted(true)
  }, [resolved.placeholder.kind, classic])

  // Classic-mode URLs are in the HTML, so the browser decides when to load.
  useEffect(() => {
    if (triggered || classic) return
    if (eager) {
      setTriggered(true)
      return
    }
    const box = boxRef.current
    if (!box) return
    return whenVisible(box, { rootMargin: margin, dwellTime: config.dwellTime }, () => setTriggered(true))
  }, [triggered, classic, eager, margin, config.dwellTime])

  // Measured mode (spec 6.2): measure, pick the format, then keep `sizes` and
  // the fill ratio current.
  useEffect(() => {
    const box = boxRef.current
    if (!triggered || classic || !owned || !box) return
    const options: MeasureOptions = { ladder: loader.widths, ratios: loader.ratios, srcWidth, trackRatio }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // A hidden box measures 0 and waits for the ResizeObserver.
    const initial = box.getBoundingClientRect()
    if (initial.width > 0) setMeasure((current) => current ?? firstMeasure(initial, options))

    // Once detection has finished, the format lands in the same render as
    // the measure; only while it is pending does the image wait (spec 6.4).
    const formats = loader.formats
    const known = formats === 'auto' ? undefined : resolvedFormat()
    if (formats === 'auto') setFormat('auto')
    else if (known) setFormat(pickFormat(known, formats))
    else {
      void detectFormat().then((best) => {
        if (!cancelled) setFormat(pickFormat(best, formats))
      })
    }

    // A fixed or ratio box already at its `width` cannot grow, and `sizes`
    // never shrinks, so there is nothing to observe.
    const atMaxWidth = (layout.mode === 'fixed' || layout.mode === 'ratio') && width !== undefined && initial.width >= width
    const stop = atMaxWidth
      ? undefined
      : observeResize(box, (rect) => {
          if (rect.width <= 0) return
          const dpr = window.devicePixelRatio || 1
          setMeasure((current) => current ?? firstMeasure(rect, options))
          // Trailing debounce: a window drag fires every frame, so only the
          // size it settles on counts.
          clearTimeout(timer)
          timer = setTimeout(() => setMeasure((current) => current && grow(current, rect, dpr, options)), SIZES_DEBOUNCE)
        })
    return () => {
      cancelled = true
      clearTimeout(timer)
      stop?.()
    }
  }, [triggered, classic, owned, loader, srcWidth, trackRatio, layout.mode, width])

  const classicUrls = useMemo(
    () => (classic && owned ? classicSources({ src, loader, width, sizes, srcWidth, crop, quality: q, version }) : undefined),
    [classic, owned, src, loader, width, sizes, srcWidth, crop, q, version],
  )

  const ratio = trackRatio ? measure?.ratio : crop
  const measuredSrcSet = useMemo(() => {
    if (classic || !owned || !measure || !format) return undefined
    return buildSrcSet({
      src,
      widths: measuredCandidates({ measuredWidth: measure.width, ladder: loader.widths, srcWidth }),
      aspectRatio: ratio,
      quality: q,
      format,
      version,
      loader,
    })
  }, [classic, owned, measure, format, src, loader, srcWidth, ratio, q, version])
  const srcSet = classicUrls?.srcSet ?? measuredSrcSet
  const imgSizes = classicUrls?.sizes ?? (measuredSrcSet && measure ? `${measure.width}px` : undefined)
  const externalSrc = !owned && (classic || triggered) ? src : undefined
  const imgSrc = classicUrls?.src ?? externalSrc
  const source = srcSet ?? externalSrc

  if (priority && imgSrc !== undefined) {
    // React dedupes this with the preload it emits for the <img> itself only
    // when href, imageSrcSet and imageSizes are identical strings (spec 7.1).
    preload(imgSrc, {
      as: 'image',
      imageSrcSet: srcSet,
      imageSizes: srcSet === undefined ? undefined : imgSizes,
      fetchPriority: 'high',
      crossOrigin: imgProps.crossOrigin,
      referrerPolicy: imgProps.referrerPolicy,
    })
  }
  // Classic-mode images are visible from the first paint (spec 9).
  const fades = !classic

  const reveal = useCallback((img: HTMLImageElement, event?: SyntheticEvent<HTMLImageElement>) => {
    const expected = img.currentSrc
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, DECODE_TIMEOUT)
    })
    // decode() never settles in some WebKit versions, hence the timeout.
    void Promise.race([img.decode().catch(() => {}), timeout]).then(() => {
      clearTimeout(timer)
      // A newer source is on its way; its own load event reveals it.
      if (!alive.current || revealed.current || img.currentSrc !== expected) return
      revealed.current = true
      setFadeIn(prefersReducedMotion() ? 0 : latest.current.fadeMs)
      setStatus('loaded')
      if (event) latest.current.onLoad?.(event)
    })
  }, [])

  const settle = (img: HTMLImageElement, event?: SyntheticEvent<HTMLImageElement>) => {
    if (revealed.current) return
    if (fades) {
      reveal(img, event)
      return
    }
    revealed.current = true
    setStatus('loaded')
    if (event) onLoad?.(event)
  }
  const settleRef = useRef(settle)
  useLayoutEffect(() => {
    settleRef.current = settle
  })

  // Runs again for every new source, to catch images that were complete
  // (cached) before React could see their load event (spec 9 step 3).
  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return
      if (source && !revealed.current && img.complete && img.currentSrc) {
        if (img.naturalWidth === 0) setStatus('error')
        else settleRef.current(img)
      }
      if (typeof ref === 'function') {
        const cleanup = ref(img)
        return () => {
          if (typeof cleanup === 'function') cleanup()
          else ref(null)
        }
      }
      if (ref) {
        ref.current = img
        return () => {
          ref.current = null
        }
      }
      return undefined
    },
    [ref, source],
  )

  useEffect(() => {
    if (!fadeIn) return
    const timer = setTimeout(() => setFadeDone(true), fadeIn)
    return () => clearTimeout(timer)
  }, [fadeIn])

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => settle(event.currentTarget, event)
  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    // A failed upgrade leaves the displayed image alone.
    if (!revealed.current) setStatus('error')
    onError?.(event)
  }

  const state = source === undefined ? 'idle' : (status ?? 'loading')
  // The background goes once the fade is over, so transparent images don't show it (spec 8).
  const settled = status === 'loaded' && (!fadeIn || fadeDone)

  let placeholderStyle: PlaceholderStyle | undefined
  if (!settled) {
    const { placeholder: parsed, value } = resolved
    if (parsed.kind !== 'thumbhash') placeholderStyle = parsed.ssrStyle
    else if (config.thumbhashSsr === 'image' || priority) {
      placeholderStyle = thumbhashImageStyle(value.trim().slice(THUMBHASH_PREFIX.length))
    } else placeholderStyle = triggered || mounted ? parsed.clientStyle() : parsed.ssrStyle
  }

  let fadeStyle: CSSProperties | undefined
  if (fades && source !== undefined) {
    fadeStyle =
      fadeIn === undefined
        ? { opacity: 0 }
        : { opacity: 1, transition: fadeIn > 0 ? `opacity ${fadeIn}ms ease-out` : undefined }
  }

  const imgWidth = layout.imgWidth
  const imgHeight =
    layout.imgHeight ??
    (layout.mode === 'intrinsic' && width !== undefined && srcWidth && srcHeight
      ? Math.round((width * srcHeight) / srcWidth)
      : undefined)

  return (
    <span
      ref={boxRef}
      className={wrapperClassName}
      data-state={state}
      style={{ ...layout.boxStyle, ...placeholderStyle, ...wrapperStyle }}
    >
      <img
        {...imgProps}
        ref={imgRef}
        alt={alt}
        // React sets changed attributes in prop order, and WebKit selects a
        // candidate as soon as srcset is set: sizes must already be there, or
        // it fetches the 100vw candidate first.
        sizes={srcSet ? imgSizes : undefined}
        src={imgSrc}
        srcSet={srcSet}
        width={imgWidth}
        height={imgHeight}
        loading={classic && !eager ? 'lazy' : undefined}
        decoding={decoding}
        fetchPriority={priority ? 'high' : undefined}
        className={className}
        onLoad={handleLoad}
        onError={handleError}
        style={{ ...layout.imgStyle, ...fadeStyle, ...style }}
      />
      {!classic && (
        <NoScriptImage
          src={src}
          alt={alt}
          owned={owned}
          loader={loader}
          quality={q}
          crop={crop}
          srcWidth={srcWidth}
          version={version}
          width={imgWidth}
          height={imgHeight}
          className={className}
          style={{ ...layout.imgStyle, ...(layout.mode === 'intrinsic' ? null : { position: 'absolute', inset: 0 }), ...style }}
        />
      )}
    </span>
  )
}

interface NoScriptImageProps {
  src: string
  alt: string
  owned: boolean
  loader: ResolvedLoader
  quality: number
  crop?: number
  srcWidth?: number
  version?: string
  width?: number
  height?: number
  className?: string
  style: CSSProperties
}

/**
 * The image for visitors without JavaScript (spec 7.3): the classic-mode
 * candidates (1× and 2× of `width`, or the full ladder without it), declared
 * crop, WebP, since nothing can be measured.
 */
function NoScriptImage({ src, owned, loader, quality, crop, srcWidth, version, ...img }: NoScriptImageProps) {
  const { width } = img
  const sources = useMemo(
    () => (owned ? classicSources({ src, loader, width, srcWidth, crop, quality, version }) : undefined),
    [owned, src, loader, width, srcWidth, crop, quality, version],
  )
  if (!sources) {
    return (
      <noscript>
        <img {...img} src={src} loading="lazy" decoding="async" />
      </noscript>
    )
  }
  return (
    <noscript>
      <img {...img} srcSet={sources.srcSet} sizes={sources.sizes} loading="lazy" decoding="async" />
    </noscript>
  )
}
