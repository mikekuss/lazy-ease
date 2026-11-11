'use client'

import { createContext, use, useMemo, type ReactNode } from 'react'
import { createLoader, normalizeLoader, type ImageLoader, type ImageLoaderFunction, type ResolvedLoader, type ThumbHashDecoder } from '@lazy-ease/core'

/**
 * - `lazy`: load when the image comes within `rootMargin` of the root, with a fade
 * - `eager`: load right after hydration, with a fade
 * - `native`: real sources in the server HTML; the browser loads them with `loading="lazy"`
 */
export type LoadingStrategy = 'lazy' | 'native' | 'eager'

/** Provider defaults. */
export interface LazyEaseConfig {
  /** Carries the width ladder, ratio ladder, qualities and formats. */
  loader: ResolvedLoader
  /** Extra hosts served by the loader besides relative paths. */
  domains: readonly string[]
  quality: number
  loading: LoadingStrategy
  /** The scrolling element lazy images are observed against. Default: the viewport. */
  root?: Element | Document | null
  /** How far outside the root to start loading, as a CSS margin. */
  rootMargin: string
  /** How long a box must stay in the preload zone before it loads, in ms. */
  dwellTime: number
  /** Used when an image has no `placeholder` prop or an invalid one. */
  placeholder: string
  /** Crossfade duration in ms. 0 swaps instantly. */
  fadeDuration: number
  /**
   * Enables `thumbhash:` placeholders: `thumbhashDecoder(thumbhash)` from
   * `@lazy-ease/core/thumbhash`, with the `thumbhash` package the app installs.
   */
  thumbhash?: ThumbHashDecoder
  /** `'image'` renders decoded ThumbHash images on the server instead of only their average color. */
  thumbhashSsr: 'color' | 'image'
}

let defaultLoader: ResolvedLoader | undefined

const defaultConfig: LazyEaseConfig = {
  // Built on first use, so importing the package computes no ladder.
  get loader() {
    return (defaultLoader ??= createLoader())
  },
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
  root,
  rootMargin,
  dwellTime,
  placeholder,
  fadeDuration,
  thumbhash,
  thumbhashSsr,
}: LazyEaseProviderProps) {
  const parent = useLazyEaseConfig()
  const value = useMemo<LazyEaseConfig>(
    () => ({
      loader: loader ? normalizeLoader(loader) : parent.loader,
      domains: domains ?? parent.domains,
      quality: quality ?? parent.quality,
      loading: loading ?? parent.loading,
      root: root === undefined ? parent.root : root,
      rootMargin: rootMargin ?? parent.rootMargin,
      dwellTime: dwellTime ?? parent.dwellTime,
      placeholder: placeholder ?? parent.placeholder,
      fadeDuration: fadeDuration ?? parent.fadeDuration,
      thumbhash: thumbhash ?? parent.thumbhash,
      thumbhashSsr: thumbhashSsr ?? parent.thumbhashSsr,
    }),
    [parent, loader, domains, quality, loading, root, rootMargin, dwellTime, placeholder, fadeDuration, thumbhash, thumbhashSsr],
  )
  return <LazyEaseContext value={value}>{children}</LazyEaseContext>
}
