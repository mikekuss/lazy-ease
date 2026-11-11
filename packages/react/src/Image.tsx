'use client'

import { useCallback, useEffect, useRef, type CSSProperties, type ImgHTMLAttributes, type Ref, type SyntheticEvent } from 'react'
import { preload } from 'react-dom'
import {
  candidateSet,
  classicCandidates,
  createLazyEase,
  focusStyles,
  fullLadder,
  isDirect,
  normalizeFocalPoint,
  normalizeLoader,
  parsePlaceholder,
  percentPosition,
  snapQuality,
  snapRatio,
  type AttachOptions,
  type FocalPoint,
  type ImageLoader,
  type ImageLoaderFunction,
  type LoadState,
  type ResolvedLoader,
  type ThumbHashDecoder,
} from '@lazy-ease/core'
import { useLazyEaseConfig, type LoadingStrategy } from './context.js'
import { warnOnce } from './dev.js'
import { invalidCombination } from './layout.js'

// The development checks below read `process.env.NODE_ENV` inside a `try`.
// Bundlers replace the expression, so a production build folds the check to
// `if (false)` and drops it, and a development build runs it even without a
// `process` global (Vite). Without a bundler, `process` is missing: that read
// throws before `dev` is set, so the error is swallowed and the checks are
// skipped; an error from the checks themselves is rethrown. They are written
// out where they are used, because esbuild folds neither a helper nor a flag
// assigned inside a `try`.
declare const process: { env: { NODE_ENV?: string } }

/** One art-direction source of a `<picture>`. */
export interface ImageSource {
  /** The media query it applies under, e.g. `'(min-width: 800px)'`. */
  media: string
  src: string
  /** The ratio the backend crops this source to. */
  aspectRatio?: number
  /** Oriented source dimensions. */
  srcWidth?: number
  srcHeight?: number
  /** Kept in view when cropped, in percent of the source. */
  focalPoint?: FocalPoint
  /** Slot of this source. Default: the image's `sizes`, else `100vw`. */
  sizes?: string
  /** Crop token from the backend for this source. */
  token?: string
  version?: string
}

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
  /**
   * Who crops a cropped image. Default: the browser for a fill image without
   * `aspectRatio` whose source dimensions are known, otherwise the server.
   */
  crop?: 'server' | 'browser'
  /** Prepared slot: the candidates are built for it and activated with a fade. */
  sizes?: string
  /** Oriented width of the source. Ladder widths above it are not offered. */
  srcWidth?: number
  /** Oriented height of the source. With `srcWidth`, reserves the intrinsic ratio. */
  srcHeight?: number
  /** Opaque revision passed to the loader. */
  version?: string
  /** Opaque crop token passed to the loader, for a backend that signs crops. */
  token?: string
  /**
   * The point to keep in view when the image is cropped, in percent of the
   * source (0–100), on the server and in the browser. Default: the center.
   */
  focalPoint?: FocalPoint
  /** Snapped to the nearest quality the loader allows. */
  quality?: number
  /** `lazy` and `eager` fade in after activation; `native` puts the real sources in the HTML. */
  loading?: LoadingStrategy
  /** Preload distance for `loading="lazy"`. */
  rootMargin?: string
  /** Native, eager, `fetchpriority="high"`, no fade and a preload. For the LCP image only. */
  priority?: boolean
  /** A CSS color, a data URI, `thumbhash:<base64>` (with the provider's `thumbhash` decoder) or `'none'`. */
  placeholder?: string
  /** Crossfade in ms. 0 swaps directly and needs no box. */
  fadeDuration?: number
  /** Loads `src` as is, without the loader. */
  unoptimized?: boolean
  loader?: ImageLoader | ImageLoaderFunction
  /** Art-direction sources, in a `<picture>`. Their ratios belong in CSS, through `--le-ar` on the box. */
  sources?: readonly ImageSource[]
  /** Adds native markup in `<noscript>` for visitors without JavaScript. Deferred images only. */
  noScript?: boolean
  /** Every state change. `loaded` once per source, also for an image that loaded before hydration. */
  onStateChange?: (state: LoadState, img: HTMLImageElement) => void
  /** Keeps the box element, and its styles and class. */
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
  /** Forwarded to the `<img>`. */
  ref?: Ref<HTMLImageElement>
}

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

interface Sources {
  src: string
  srcSet?: string
  sizes?: string
}

/** The native candidates for a slot: 1× and 2× of a known `width`, else the full ladder. */
function nativeSources(
  loader: ResolvedLoader,
  src: string,
  direct: boolean,
  { srcWidth, srcHeight, crop, focus, sizes, width, quality, version, token }: { srcWidth?: number; srcHeight?: number; crop?: number; focus?: FocalPoint; sizes?: string; width?: number; quality: number; version?: string; token?: string },
): Sources {
  if (direct) return { src }
  const { formats, widths: ladder } = loader
  // Nothing is detected yet, so the server HTML takes WebP.
  const format = formats === 'auto' ? formats : (['webp', 'jpeg'] as const).find((f) => formats.includes(f)) ?? formats[0]!
  const set = candidateSet({
    // A known width caps the slot at 2×, also under `sizes`.
    widths: width === undefined ? fullLadder({ ladder, srcWidth }) : classicCandidates({ width, ladder, srcWidth }),
    srcWidth,
    srcHeight,
    loader,
    src,
    aspectRatio: crop,
    focalPoint: crop ? focus : undefined,
    quality,
    format,
    version,
    token,
  })
  return { src: set.src, srcSet: set.srcset, sizes: set.srcset && (sizes ?? (width ? `${width}px` : '100vw')) }
}

/** Calls `ref` with `node`, as React does, and returns its cleanup. */
function setRef(ref: Ref<HTMLImageElement> | undefined, node: HTMLImageElement | null) {
  if (typeof ref == 'function') return ref(node)
  if (ref) ref.current = node
}

/**
 * An image that loads at the size it is rendered at, behind an inline
 * placeholder, through the lazy-ease controller of `@lazy-ease/core`.
 */
export function Image(props: ImageProps) {
  // A new src is a new logical source: it starts over with its placeholder.
  return <ImageBox key={props.src} {...props} />
}

function ImageBox({
  src,
  alt,
  width,
  height,
  aspectRatio,
  fill = false,
  crop,
  sizes,
  srcWidth,
  srcHeight,
  version,
  token,
  focalPoint,
  quality,
  loading,
  rootMargin,
  priority = false,
  placeholder,
  fadeDuration,
  unoptimized = false,
  loader: loaderProp,
  sources = [],
  noScript = false,
  onStateChange,
  wrapperClassName,
  wrapperStyle,
  className,
  style,
  onLoad,
  decoding = 'async',
  ref,
  ...imgProps
}: ImageProps) {
  const config = useLazyEaseConfig()
  const strategy = loading ?? config.loading
  const native = priority || strategy === 'native'

  let dev = false
  try {
    if (process.env.NODE_ENV !== 'production') {
      dev = true
      const problem = invalidCombination({ fill, width, height, aspectRatio, sizes, priority, loading: strategy, crop, srcWidth, srcHeight })
      if (problem) throw new Error(`[lazy-ease] ${problem} (src: ${src})`)
    }
  } catch (error) {
    if (dev) throw error
  }

  const direct = unoptimized || isDirect(src, config.domains)
  const loader = loaderProp && !direct ? normalizeLoader(loaderProp) : config.loader
  const q = snapQuality(quality ?? config.quality, loader.qualities)
  const fadeMs = fadeDuration ?? config.fadeDuration
  const measured = !native && !direct && sizes === undefined
  const mode = fill ? 'fill' : height !== undefined ? 'fixed' : aspectRatio !== undefined ? 'ratio' : 'intrinsic'
  const declared = mode === 'fixed' ? width! / height! : aspectRatio
  const sourceRatio = srcWidth && srcHeight ? srcWidth / srcHeight : undefined
  // Mirrors the controller: the browser crops a fill image without a declared ratio when it knows the source's.
  const browserCrop = mode !== 'intrinsic' && (crop ? crop === 'browser' : fill && declared === undefined && !!sourceRatio)
  const serverCrop = mode === 'intrinsic' || browserCrop || declared === undefined || direct ? undefined : snapRatio(declared, loader.ratios)
  const focus = mode === 'intrinsic' ? undefined : normalizeFocalPoint(focalPoint)
  const prepared = (slot: string | undefined) =>
    nativeSources(loader, src, direct, { srcWidth, srcHeight, crop: serverCrop, focus, sizes: slot, width, quality: q, version, token })
  const real = measured ? undefined : prepared(sizes)

  // The placeholder; an invalid value falls back to the provider's.
  const decoder = config.thumbhash
  const requested = parsePlaceholder(placeholder ?? config.placeholder, decoder)
  const parsed = requested ?? parsePlaceholder(config.placeholder, decoder) ?? { style: {} }
  // A decoded ThumbHash on the server, or only its color with the image swapped in on activation.
  const ssrImage = parsed.lazy && (config.thumbhashSsr === 'image' || priority)
  // A copy: the parsed styles are shared, memoized per hash.
  const paint: CSSProperties = { ...(ssrImage ? parsed.lazy!() : parsed.style) }
  if (paint.backgroundImage) paint.backgroundPosition = focus ? percentPosition(focus) : 'center'

  const focused = focus && !measured ? focusStyles({ focus, crop: serverCrop, srcWidth, srcHeight }) : undefined
  // A box only where something needs it: fill, a fade, browser focal positioning or wrapper props.
  const boxed =
    fill || wrapperClassName !== undefined || wrapperStyle !== undefined || (!native && fadeMs > 0) || (measured ? !!focus : !!focused?.box.containerType)

  const ratio = mode === 'fixed' ? `${width} / ${height}` : mode === 'ratio' ? `${aspectRatio}` : sourceRatio && `${srcWidth} / ${srcHeight}`
  // With breakpoint sources, CSS owns the ratio: `--le-ar` on the box or an ancestor.
  const ar = ratio && (sources.length ? `var(--le-ar, ${ratio})` : ratio)
  const slot: CSSProperties = fill
    ? { position: 'absolute', inset: 0 }
    : { width: width ?? '100%', maxWidth: mode === 'fixed' ? '100%' : undefined, aspectRatio: ar }
  const cover = fill || !!ar
  const imgStyle: CSSProperties = boxed
    ? { display: 'block', width: '100%', height: cover ? '100%' : 'auto', objectFit: cover ? 'cover' : undefined, ...focused?.img, ...style }
    : { display: 'block', ...slot, height: 'auto', objectFit: cover ? 'cover' : undefined, ...focused?.img, ...paint, ...style }

  const imgWidth = fill ? undefined : (width ?? (mode === 'intrinsic' ? srcWidth : undefined))
  const imgHeight =
    mode === 'fixed'
      ? height
      : imgWidth && (mode === 'ratio' ? Math.round(imgWidth / aspectRatio!) : sourceRatio && Math.round(imgWidth / sourceRatio))

  const pictureSources = sources.map((source) => {
    const sourceCrop = source.aspectRatio && snapRatio(source.aspectRatio, loader.ratios)
    const set = nativeSources(loader, source.src, isDirect(source.src, config.domains), {
      ...source,
      crop: sourceCrop,
      focus: normalizeFocalPoint(source.focalPoint),
      sizes: source.sizes ?? sizes ?? '100vw',
      quality: q,
    })
    return { media: source.media, src: set.src, srcSet: set.srcSet ?? set.src, sizes: set.sizes }
  })

  if (priority) {
    // At most one preload: the first source under its media query, else the img itself,
    // from the same strings as the markup so React dedupes it with its own.
    const first = pictureSources[0] ?? real!
    preload(first.src, {
      as: 'image',
      imageSrcSet: first.srcSet,
      imageSizes: first.sizes,
      media: pictureSources[0]?.media,
      fetchPriority: 'high',
      crossOrigin: imgProps.crossOrigin,
      referrerPolicy: imgProps.referrerPolicy,
    })
  }

  const self = useRef<HTMLImageElement>(null)
  const imgRef = useCallback((node: HTMLImageElement | null) => {
    self.current = node
    return setRef(ref, node)
  }, [ref])
  // The latest callbacks, loader and decoder, for an attachment that outlives renders.
  const latest = useRef({
    onLoad,
    onStateChange,
    loader,
    decoder,
    event: undefined as SyntheticEvent<HTMLImageElement> | undefined,
    // The currentSrc the stored load event was for.
    eventSrc: '',
    state: '',
    shown: false,
    hidden: false,
  })
  Object.assign(latest.current, { onLoad, onStateChange, loader, decoder })

  let options: AttachOptions = { loading: strategy === 'eager' ? 'eager' : undefined, rootMargin: rootMargin ?? config.rootMargin, dwellTime: config.dwellTime, fadeDuration: fadeMs }
  if (native) options = { ...options, loading: 'native', priority }
  else if (measured)
    options = { ...options, src, quality: q, width, height, aspectRatio, fill, crop, srcWidth, srcHeight, focalPoint: focus, version, token }
  else options = { ...options, srcset: real!.srcSet, sizes: real!.sizes, url: real!.src }
  // Only a ThumbHash shown as its color goes to the controller, which swaps in the image on activation.
  if (!native && parsed.lazy && !ssrImage) options.placeholder = requested ? (placeholder ?? config.placeholder) : config.placeholder
  // Equivalent config keeps the attachment: the loader and decoder are compared by
  // what they offer and called through `latest`, so inline ones don't re-attach.
  // For a measured image, a probe URL tells a changed URL scheme from an inline loader
  // with the same output. Prepared images carry their URLs in `options`, native ones
  // in the img's own attributes, and a direct source must never reach the loader.
  const { widths, ratios, qualities, formats } = loader
  const probe = measured ? loader.url({ src, width: widths[0]!, quality: qualities[0]!, format: formats === 'auto' ? formats : formats[0]! }) : ''
  const signature = JSON.stringify([options, pictureSources, config.domains, widths, ratios, qualities, formats, probe, !!decoder])

  useEffect(() => {
    const img = self.current!
    const state = latest.current
    // The SSR placeholder sets the background position, which the decoded image keeps.
    const thumbhash: ThumbHashDecoder | undefined =
      decoder &&
      ((hash) => {
        const decoded = state.decoder?.(hash)
        const lazy = decoded?.lazy
        return decoded && { style: decoded.style, lazy: lazy && (() => ({ ...lazy(), backgroundPosition: 'center' })) }
      })
    const attachment = createLazyEase({ thumbhash, domains: config.domains }).attach(img, {
      ...options,
      loader: { widths, ratios, qualities, formats, url: (params) => state.loader.url(params) },
      root: config.root,
      onStateChange(next) {
        if (state.state === next) return
        state.state = next
        state.onStateChange?.(next, img)
      },
      onDisplay(_, event) {
        // A native image calls onLoad from its React handler.
        if (state.shown || native) {
          if (!event) state.shown = true
          return
        }
        // Adoption has no event of its own. A load seen for this very source before a
        // re-attach (one mid-decode) is still its first load; otherwise no onLoad follows.
        const loaded = state.event && (event ? state.event.nativeEvent === event : state.eventSrc === img.currentSrc)
        if (event && !loaded) return
        state.shown = true
        if (!loaded) return
        const synthetic = state.event as unknown as { currentTarget: EventTarget | null }
        // React has reset currentTarget since the event was dispatched.
        synthetic.currentTarget = img
        state.onLoad?.(state.event!)
        synthetic.currentTarget = null
      },
    })
    // A target hidden for its fade before a re-attach (Strict Mode) is hidden again, so it still fades.
    if (state.hidden && attachment.state === 'loading') img.style.opacity = '0'
    return () => {
      state.hidden = img.style.opacity === '0' && attachment.state === 'loading'
      attachment.destroy()
    }
    // `options` is covered by its signature, which leaves out the root.
  }, [signature, config.root])

  // Mount-time development checks.
  useEffect(() => {
    let dev = false
    try {
      if (process.env.NODE_ENV !== 'production') {
        dev = true
        if (!requested) warnOnce(`placeholder:${src}`, `Invalid placeholder for ${src}${decoder ? '' : ' (thumbhash: needs the provider’s thumbhash decoder)'}. Using the provider default.`)
        if (mode === 'intrinsic' && !sourceRatio) {
          warnOnce(`intrinsic:${src}`, `${src} has no height to reserve and will shift the layout when it loads. Add \`srcWidth\` and \`srcHeight\`, \`aspectRatio\`, \`height\` or \`fill\`.`)
        }
        if (loaderProp && direct) warnOnce(`loader:${src}`, `${src} loads as is, so its \`loader\` prop is ignored.`)
        const rect = self.current!.getBoundingClientRect()
        if (!native && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.left < innerWidth && rect.right > 0) {
          warnOnce(`viewport:${src}`, `${src} is in the first viewport but waits for hydration. Set \`loading="native"\` or \`priority\` so its URL is in the server HTML.`)
        }
      }
    } catch (error) {
      if (dev) throw error
    }
    // Checks the props the image mounted with; later changes are not re-checked.
  }, [])

  const fallback = !native && noScript && prepared(sizes)
  const img = (
    <img
      {...imgProps}
      {...(boxed ? null : { 'data-le': '', 'data-le-auto': 'off' })}
      ref={imgRef}
      alt={alt}
      // React sets attributes in prop order, and WebKit selects a candidate as soon
      // as srcset is set: sizes must already be there.
      sizes={real && native ? real.sizes : undefined}
      src={real && native ? real.src : INERT}
      srcSet={real && native ? real.srcSet : undefined}
      width={imgWidth}
      height={imgHeight}
      loading={native && !priority ? 'lazy' : undefined}
      decoding={decoding}
      fetchPriority={priority ? 'high' : imgProps.fetchPriority}
      className={className}
      onLoad={(event) => {
        const state = latest.current
        state.event = event
        state.eventSrc = event.currentTarget.currentSrc
        // A native image calls onLoad here, with currentTarget set, on the first load of its source.
        if (native && !state.shown && event.currentTarget.currentSrc !== INERT) {
          state.shown = true
          state.onLoad?.(event)
        }
      }}
      style={imgStyle}
    />
  )
  const content = (
    <>
      {sources.length ? (
        <picture>
          {pictureSources.map((source) =>
            native ? (
              <source key={source.media} media={source.media} sizes={source.sizes} srcSet={source.srcSet} />
            ) : (
              <source key={source.media} media={source.media} data-le-sizes={source.sizes} data-le-srcset={source.srcSet} />
            ),
          )}
          {img}
        </picture>
      ) : (
        img
      )}
      {fallback && (
        <noscript>
          <img
            alt={alt}
            sizes={fallback.sizes}
            src={fallback.src}
            srcSet={fallback.srcSet}
            width={imgWidth}
            height={imgHeight}
            loading="lazy"
            decoding="async"
            className={className}
            style={{ ...imgStyle, ...(boxed && cover ? { position: 'absolute', inset: 0 } : null) }}
          />
        </noscript>
      )}
    </>
  )
  if (!boxed) return content
  return (
    <span
      data-le=""
      data-le-auto="off"
      className={wrapperClassName}
      style={{ display: 'block', position: 'relative', ...slot, ...focused?.box, ...paint, ...wrapperStyle }}
    >
      {content}
    </span>
  )
}
