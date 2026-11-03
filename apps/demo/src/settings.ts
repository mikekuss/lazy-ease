import type { ImageFormat, LoadingStrategy } from 'lazy-ease'
import { PRESETS, type PresetName } from './throttle'

export type PlaceholderMode = 'blur' | 'color' | 'none'

export interface Settings {
  throttle: PresetName | 'custom'
  latency: number
  kbps: number
  loading: LoadingStrategy
  rootMargin: number
  fadeDuration: number
  placeholder: PlaceholderMode
  formats: 'webp' | 'avif'
}

export const DEFAULT_SETTINGS: Settings = {
  throttle: 'off',
  latency: 200,
  kbps: 1000,
  loading: 'lazy',
  rootMargin: 400,
  fadeDuration: 500,
  placeholder: 'blur',
  formats: 'webp',
}

export const FORMATS: Record<Settings['formats'], ImageFormat[]> = {
  webp: ['webp'],
  avif: ['avif', 'webp'],
}

const STORAGE_KEY = 'lazy-ease-demo-settings-v2'

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    const settings = { ...DEFAULT_SETTINGS, ...stored }
    const valid =
      (settings.throttle === 'custom' || settings.throttle in PRESETS) &&
      ['blur', 'color', 'none'].includes(settings.placeholder) &&
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
