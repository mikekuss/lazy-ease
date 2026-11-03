import { createContext, use, useMemo, type ReactNode } from 'react'
import { createLoader, type ImageFormat, type ImageLoader } from './loader.js'
import { DEFAULT_WIDTHS } from './widths.js'

/**
 * - `lazy`: load when the image comes within `rootMargin` of the viewport (IntersectionObserver)
 * - `native`: leave it to the browser with `loading="lazy"`
 * - `eager`: load right away
 */
export type LoadingStrategy = 'lazy' | 'native' | 'eager'

export interface LazyEaseConfig {
  loader: ImageLoader
  widths: readonly number[]
  /** Modern formats offered as `<source>` elements, best first. JPEG is the `<img>` fallback. */
  formats: readonly ImageFormat[]
  loading: LoadingStrategy
  /** How far outside the viewport to start loading, as a CSS margin. */
  rootMargin: string
  /** Crossfade duration in milliseconds. 0 disables the fade. */
  fadeDuration: number
  quality?: number
}

const defaultConfig: LazyEaseConfig = {
  loader: createLoader(),
  widths: DEFAULT_WIDTHS,
  formats: ['webp'],
  loading: 'lazy',
  rootMargin: '400px',
  fadeDuration: 400,
}

const LazyEaseContext = createContext<LazyEaseConfig>(defaultConfig)

export function useLazyEaseConfig(): LazyEaseConfig {
  return use(LazyEaseContext)
}

export interface LazyEaseProviderProps extends Partial<LazyEaseConfig> {
  children: ReactNode
}

/** Sets defaults for every `<Image>` below it. Providers can be nested. */
export function LazyEaseProvider({
  children,
  loader,
  widths,
  formats,
  loading,
  rootMargin,
  fadeDuration,
  quality,
}: LazyEaseProviderProps) {
  const parent = useLazyEaseConfig()
  const value = useMemo<LazyEaseConfig>(
    () => ({
      loader: loader ?? parent.loader,
      widths: widths ?? parent.widths,
      formats: formats ?? parent.formats,
      loading: loading ?? parent.loading,
      rootMargin: rootMargin ?? parent.rootMargin,
      fadeDuration: fadeDuration ?? parent.fadeDuration,
      quality: quality ?? parent.quality,
    }),
    [parent, loader, widths, formats, loading, rootMargin, fadeDuration, quality],
  )
  return <LazyEaseContext value={value}>{children}</LazyEaseContext>
}
