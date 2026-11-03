import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from 'react'
import { useLazyEaseConfig, type LoadingStrategy } from './context.js'
import { snapQuality, type ImageFormat, type ImageLoader } from './loader.js'
import { whenVisible } from './observer.js'
import { snapRatio } from './ratios.js'
import { candidateWidths, snapWidth } from './widths.js'

export interface ImageProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'src' | 'srcSet' | 'width' | 'height' | 'loading' | 'placeholder'
  > {
  src: string
  alt: string
  /** Rendered width in CSS pixels. Without it the image fills its container. */
  width?: number
  height?: number
  /** width / height. Crops the image to this ratio. Defaults to width / height. */
  aspectRatio?: number
  /** Defaults to `${width}px` for fixed-width images and `100vw` otherwise. */
  sizes?: string
  quality?: number
  loading?: LoadingStrategy
  rootMargin?: string
  /** Loads eagerly with high fetch priority. Use it for the LCP image. */
  priority?: boolean
  /**
   * Inline placeholder shown as the background from the first render, e.g. a
   * data URI from `colorPlaceholder()` or the server's `/meta` route.
   */
  placeholder?: string
  fadeDuration?: number
  formats?: readonly ImageFormat[]
  loader?: ImageLoader
  /** Called once when the image starts loading. */
  onVisible?: () => void
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
}

export function Image({
  src,
  alt,
  width,
  height,
  aspectRatio,
  sizes,
  quality,
  loading,
  rootMargin,
  priority = false,
  placeholder,
  fadeDuration,
  formats,
  loader,
  onVisible,
  wrapperClassName,
  wrapperStyle,
  className,
  style,
  onLoad,
  onError,
  ...imgProps
}: ImageProps) {
  const config = useLazyEaseConfig()
  const activeLoader = loader ?? config.loader
  const activeFormats = formats ?? config.formats
  const strategy = priority ? 'eager' : (loading ?? config.loading)
  const margin = rootMargin ?? config.rootMargin
  const fade = fadeDuration ?? config.fadeDuration
  const ratio = aspectRatio ?? (width && height ? width / height : undefined)
  const q = quality ?? config.quality

  const wrapperRef = useRef<HTMLSpanElement>(null)
  const [inView, setInView] = useState(strategy !== 'lazy')
  // Keyed by src so a new src starts hidden again.
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const [settledSrc, setSettledSrc] = useState<string>()
  const [failedSrc, setFailedSrc] = useState<string>()
  const loaded = loadedSrc === src
  const settled = settledSrc === src

  useEffect(() => {
    if (strategy !== 'lazy') return setInView(true)
    const element = wrapperRef.current
    if (!element || inView) return
    return whenVisible(element, margin, () => setInView(true))
  }, [strategy, margin, inView])

  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible
  useEffect(() => {
    if (inView) onVisibleRef.current?.()
  }, [inView, src])

  const resolvedSizes = sizes ?? (width ? `${width}px` : '100vw')
  const { sources, fallbackSrcSet, fallbackSrc } = useMemo(() => {
    const widths = candidateWidths(width, config.widths)
    // Adapter to the revised loader contract until step 3 rewrites this component.
    const crop = ratio ? snapRatio(ratio, activeLoader.ratios) : undefined
    const allowedQuality = snapQuality(q ?? 75, activeLoader.qualities)
    const urlFor = (w: number, format: ImageFormat) =>
      activeLoader.url({ src, width: w, aspectRatio: crop, quality: allowedQuality, format })
    const srcSetFor = (format: ImageFormat) => widths.map((w) => `${urlFor(w, format)} ${w}w`).join(', ')
    return {
      sources: activeFormats.map((format) => ({ type: `image/${format}`, srcSet: srcSetFor(format) })),
      fallbackSrcSet: srcSetFor('jpeg'),
      fallbackSrc: urlFor(snapWidth(width ?? 1080, config.widths), 'jpeg'),
    }
  }, [activeLoader, activeFormats, src, width, ratio, q, config.widths])

  // Only reveal once the bytes are there and decoded, so the image never
  // paints progressively (top to bottom) over the placeholder.
  const reveal = useCallback(
    (img: HTMLImageElement) => {
      img
        .decode()
        .catch(() => {})
        .then(() => {
          setLoadedSrc(src)
          if (fade === 0) setSettledSrc(src)
        })
    },
    [src, fade],
  )

  // Cached images can finish before React attaches onLoad (e.g. after hydration).
  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) reveal(img)
    },
    [reveal],
  )

  const handleLoad = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    reveal(event.currentTarget)
    onLoad?.(event)
  }

  const handleError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    setFailedSrc(src)
    onError?.(event)
  }

  const state = !inView ? 'idle' : failedSrc === src ? 'error' : loaded ? 'loaded' : 'loading'

  return (
    <span
      ref={wrapperRef}
      className={wrapperClassName}
      data-state={state}
      style={{
        position: 'relative',
        display: 'block',
        overflow: 'hidden',
        width: width ?? '100%',
        maxWidth: '100%',
        aspectRatio: ratio,
        backgroundImage: placeholder && !settled ? `url("${placeholder.replace(/"/g, '%22')}")` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...wrapperStyle,
      }}
    >
      <picture style={{ display: 'contents' }}>
        {inView &&
          sources.map((source) => (
            <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={resolvedSizes} />
          ))}
        <img
          {...imgProps}
          ref={imgRef}
          alt={alt}
          src={inView ? fallbackSrc : undefined}
          srcSet={inView ? fallbackSrcSet : undefined}
          sizes={resolvedSizes}
          width={width}
          height={ratio && width ? Math.round(width / ratio) : height}
          loading={strategy === 'native' ? 'lazy' : 'eager'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          className={className}
          onLoad={handleLoad}
          onError={handleError}
          onTransitionEnd={() => loaded && setSettledSrc(src)}
          style={{
            display: 'block',
            width: '100%',
            height: ratio ? '100%' : 'auto',
            objectFit: 'cover',
            ...(ratio ? { position: 'absolute', inset: 0 } : null),
            opacity: loaded ? 1 : 0,
            transition: fade > 0 ? `opacity ${fade}ms ease-out` : undefined,
            ...style,
          }}
        />
      </picture>
    </span>
  )
}
