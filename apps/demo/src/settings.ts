import type { ImageFormat, LoadingStrategy } from 'lazy-ease'
import { PRESETS, type PresetName } from './throttle'

export type PlaceholderKind = 'thumbhash' | 'color' | 'none'

export interface Settings {
  throttle: PresetName | 'custom'
  latency: number
  kbps: number
  loading: LoadingStrategy
  rootMargin: number
  dwellTime: number
  fadeDuration: number
  placeholder: PlaceholderKind
  formats: 'avif' | 'webp'
}

export const DEFAULT_SETTINGS: Settings = {
  throttle: 'off',
  latency: 200,
  kbps: 1000,
  loading: 'lazy',
  rootMargin: 400,
  dwellTime: 0,
  fadeDuration: 400,
  placeholder: 'thumbhash',
  formats: 'avif',
}

/** The formats the loader declares; the component picks the first one the browser decodes. */
export const FORMATS: Record<Settings['formats'], readonly ImageFormat[]> = {
  avif: ['avif', 'webp', 'jpeg'],
  webp: ['webp', 'jpeg'],
}

const STORAGE_KEY = 'lazy-ease-demo-settings-v3'

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    const settings = { ...DEFAULT_SETTINGS, ...stored }
    const valid =
      (settings.throttle === 'custom' || settings.throttle in PRESETS) &&
      ['lazy', 'native', 'eager'].includes(settings.loading) &&
      ['thumbhash', 'color', 'none'].includes(settings.placeholder) &&
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
