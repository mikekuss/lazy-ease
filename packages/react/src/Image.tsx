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
import { useLazyEaseConfig, type LoadingStrategy } from './context.js'
import { DEV, warnOnce } from './dev.js'
import { detectFormat } from './format.js'
import { invalidCombination, resolveLayout } from './layout.js'
import {
  normalizeLoader,
  snapQuality,
  type ImageFormat,
  type ImageLoader,
  type ImageLoaderFunction,
  type ResolvedLoader,
} from './loader.js'
import { whenVisible } from './observer.js'
import { isOwned } from './owned.js'
import { parsePlaceholder, thumbhashImageStyle, type Placeholder, type PlaceholderStyle } from './placeholder.js'
import { snapRatio } from './ratios.js'
import { buildSrcSet } from './srcset.js'
import { fullLadder, measuredCandidates, snapWidth } from './widths.js'

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

function firstMeasure(box: DOMRectReadOnly, { ratios, trackRatio }: MeasureOptions): Measure {
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
function grow(current: Measure, box: DOMRectReadOnly, dpr: number, options: MeasureOptions): Measure {
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
  // TODO(step 4): classic mode (spec 6.3). `sizes`, `priority` and
  // `loading="native"` should put src/srcset in the server HTML, emit the
  // priority preload and use `loading="lazy"` for native. Until then they go
  // through the measured path below, but never fade: a classic-mode image
  // must never get `opacity: 0` (spec 9).
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

  useEffect(() => {
    if (resolved.placeholder.kind === 'thumbhash') setMounted(true)
  }, [resolved.placeholder.kind])

  useEffect(() => {
    if (triggered) return
    if (eager) {
      setTriggered(true)
      return
    }
    const box = boxRef.current
    if (!box) return
    return whenVisible(box, { rootMargin: margin, dwellTime: config.dwellTime }, () => setTriggered(true))
  }, [triggered, eager, margin, config.dwellTime])

  // Measured mode (spec 6.2): measure, pick the format, then keep `sizes` and
  // the fill ratio current.
  useEffect(() => {
    const box = boxRef.current
    if (!triggered || !owned || !box) return
    const options: MeasureOptions = { ladder: loader.widths, ratios: loader.ratios, srcWidth, trackRatio }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // A hidden box measures 0 and waits for the ResizeObserver.
    const initial = box.getBoundingClientRect()
    if (initial.width > 0) setMeasure((current) => current ?? firstMeasure(initial, options))

    const formats = loader.formats
    void (formats === 'auto' ? Promise.resolve('auto' as const) : detectFormat().then((best) => pickFormat(best, formats))).then(
      (picked) => {
        if (!cancelled) setFormat(picked)
      },
    )

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        const rect = box.getBoundingClientRect()
        if (rect.width <= 0) return
        const dpr = window.devicePixelRatio || 1
        setMeasure((current) => current ?? firstMeasure(rect, options))
        // Trailing debounce: a window drag fires every frame, so only the
        // size it settles on counts.
        clearTimeout(timer)
        timer = setTimeout(() => setMeasure((current) => current && grow(current, rect, dpr, options)), SIZES_DEBOUNCE)
      })
      observer.observe(box)
    }
    return () => {
      cancelled = true
      clearTimeout(timer)
      observer?.disconnect()
    }
  }, [triggered, owned, loader, srcWidth, trackRatio])

  const ratio = trackRatio ? measure?.ratio : crop
  const srcSet = useMemo(() => {
    if (!owned || !measure || !format) return undefined
    return buildSrcSet({
      src,
      widths: measuredCandidates({ measuredWidth: measure.width, ladder: loader.widths, srcWidth }),
      aspectRatio: ratio,
      quality: q,
      format,
      version,
      loader,
    })
  }, [owned, measure, format, src, loader, srcWidth, ratio, q, version])
  const externalSrc = !owned && triggered ? src : undefined
  const source = srcSet ?? externalSrc
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
    } else placeholderStyle = mounted ? parsed.clientStyle() : parsed.ssrStyle
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
        src={externalSrc}
        srcSet={srcSet}
        sizes={srcSet && measure ? `${measure.width}px` : undefined}
        width={imgWidth}
        height={imgHeight}
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
          sizes={sizes}
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
  sizes?: string
  srcWidth?: number
  version?: string
  width?: number
  height?: number
  className?: string
  style: CSSProperties
}

/**
 * The image for visitors without JavaScript (spec 7.3): the classic-mode
 * srcset (full ladder, declared crop, WebP), since nothing can be measured.
 */
function NoScriptImage({ src, owned, loader, quality, crop, sizes, srcWidth, version, ...img }: NoScriptImageProps) {
  if (!owned) {
    return (
      <noscript>
        <img {...img} src={src} loading="lazy" decoding="async" />
      </noscript>
    )
  }
  const srcSet = buildSrcSet({
    src,
    widths: fullLadder({ ladder: loader.widths, srcWidth }),
    aspectRatio: crop,
    quality,
    format: loader.formats === 'auto' ? 'auto' : pickFormat('webp', loader.formats),
    version,
    loader,
  })
  return (
    <noscript>
      <img {...img} srcSet={srcSet} sizes={sizes ?? '100vw'} loading="lazy" decoding="async" />
    </noscript>
  )
}
