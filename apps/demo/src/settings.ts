import type { ImageFormat, LoadingStrategy } from '@lazy-ease/react'
import { STATIC } from './mode'
import { PRESETS, type NetworkProfile, type PresetName } from './throttle'

export type PlaceholderKind = 'thumbhash' | 'color' | 'none'
/** Crossfade, focus reveal (`focusReveal`) or no fade. */
export type RevealKind = 'fade' | 'focus' | 'none'

/** The fade lengths the bar offers. */
export const FADES = [300, 600, 1200] as const

export interface Settings {
  throttle: PresetName | 'custom'
  latency: number
  kbps: number
  loading: LoadingStrategy
  rootMargin: number
  dwellTime: number
  fadeDuration: number
  reveal: RevealKind
  placeholder: PlaceholderKind
  formats: 'avif' | 'webp'
  /** Captions with state, sizes and bytes, and the totals in the bar. */
  details: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  // A little slow, so the placeholder and the fade are visible.
  throttle: 'fast-4g',
  latency: 200,
  kbps: 1000,
  loading: 'lazy',
  rootMargin: 400,
  dwellTime: 0,
  fadeDuration: 600,
  reveal: 'fade',
  placeholder: 'thumbhash',
  formats: 'avif',
  details: false,
}

/**
 * The formats the loader declares; the component picks the first one the
 * browser decodes. The static build has no JPEG variants.
 */
export const FORMATS: Record<Settings['formats'], readonly ImageFormat[]> = STATIC
  ? { avif: ['avif', 'webp'], webp: ['webp'] }
  : { avif: ['avif', 'webp', 'jpeg'], webp: ['webp', 'jpeg'] }

const STORAGE_KEY = 'lazy-ease-demo-settings-v4'

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    const settings = { ...DEFAULT_SETTINGS, ...stored }
    const valid =
      (settings.throttle === 'custom' || settings.throttle in PRESETS) &&
      ['lazy', 'native', 'eager'].includes(settings.loading) &&
      ['thumbhash', 'color', 'none'].includes(settings.placeholder) &&
      ['fade', 'focus', 'none'].includes(settings.reveal) &&
      (FADES as readonly number[]).includes(settings.fadeDuration) &&
      typeof settings.details === 'boolean' &&
      settings.formats in FORMATS
    return valid ? settings : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be unavailable (private mode); the demo works without it.
  }
}

/** Query params that make the demo server throttle the response. */
export function throttleParams(settings: Settings): Record<string, string | number> {
  if (settings.throttle === 'off') return {}
  if (settings.throttle === 'custom') return { latency: settings.latency, kbps: settings.kbps }
  return { throttle: settings.throttle }
}

/** The throttle as numbers, for the static demo's service worker, which has no preset table. */
export function throttleProfile(settings: Settings): NetworkProfile | null {
  if (settings.throttle === 'custom') return { latency: settings.latency, kbps: settings.kbps }
  return PRESETS[settings.throttle]
}
