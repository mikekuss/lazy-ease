import { createContext, use, useEffect, useMemo, type ReactNode } from 'react'
import { startFormatDetection } from './format.js'
import { createLoader, normalizeLoader, type ImageLoader, type ImageLoaderFunction, type ResolvedLoader } from './loader.js'

/**
 * - `lazy`: load when the image comes within `rootMargin` of the viewport (IntersectionObserver)
 * - `native`: leave it to the browser with `loading="lazy"` (classic mode)
 * - `eager`: load right away
 */
export type LoadingStrategy = 'lazy' | 'native' | 'eager'

/** Provider defaults (spec 5.3). */
export interface LazyEaseConfig {
  /** Carries the width ladder, ratio ladder, qualities and formats. */
  loader: ResolvedLoader
  /** Extra hosts treated as owned besides relative paths (spec 10). */
  domains: readonly string[]
  quality: number
  loading: LoadingStrategy
  /** How far outside the viewport to start loading, as a CSS margin. */
  rootMargin: string
  /** How long a box must stay in the preload zone before it loads, in ms. */
  dwellTime: number
  /** Used when an image has no `placeholder` prop or an invalid one. */
  placeholder: string
  /** Crossfade duration in ms for measured-mode images. 0 swaps instantly. */
  fadeDuration: number
  /** `'image'` renders decoded ThumbHash images on the server instead of only their average color. */
  thumbhashSsr: 'color' | 'image'
}

const defaultConfig: LazyEaseConfig = {
  loader: createLoader(),
  domains: [],
  quality: 75,
  loading: 'lazy',
  rootMargin: '400px',
  dwellTime: 0,
  placeholder: '#e5e7eb',
  fadeDuration: 400,
  thumbhashSsr: 'color',
}

const LazyEaseContext = createContext<LazyEaseConfig>(defaultConfig)

export function useLazyEaseConfig(): LazyEaseConfig {
  return use(LazyEaseContext)
}

export interface LazyEaseProviderProps extends Partial<Omit<LazyEaseConfig, 'loader'>> {
  loader?: ImageLoader | ImageLoaderFunction
  children: ReactNode
}

/** Sets defaults for every `<Image>` below it. Nested providers merge. */
export function LazyEaseProvider({
  children,
  loader,
  domains,
  quality,
  loading,
  rootMargin,
  dwellTime,
  placeholder,
  fadeDuration,
  thumbhashSsr,
}: LazyEaseProviderProps) {
  const parent = useLazyEaseConfig()

  // Started here so the result is usually in before the first image intersects (spec 6.4).
  useEffect(() => {
    void startFormatDetection()
  }, [])

  const value = useMemo<LazyEaseConfig>(
    () => ({
      loader: loader ? normalizeLoader(loader) : parent.loader,
      domains: domains ?? parent.domains,
      quality: quality ?? parent.quality,
      loading: loading ?? parent.loading,
      rootMargin: rootMargin ?? parent.rootMargin,
      dwellTime: dwellTime ?? parent.dwellTime,
      placeholder: placeholder ?? parent.placeholder,
      fadeDuration: fadeDuration ?? parent.fadeDuration,
      thumbhashSsr: thumbhashSsr ?? parent.thumbhashSsr,
    }),
    [parent, loader, domains, quality, loading, rootMargin, dwellTime, placeholder, fadeDuration, thumbhashSsr],
  )
  return <LazyEaseContext value={value}>{children}</LazyEaseContext>
}
