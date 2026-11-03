import type { LoadingStrategy } from 'lazy-ease'
import type { PlaceholderMode, Settings } from './settings'
import { useStats } from './stats'
import { PRESETS } from './throttle'

interface ControlsProps {
  settings: Settings
  onChange: (settings: Settings) => void
  onReload: () => void
}

const PRESET_LABELS: Record<keyof typeof PRESETS | 'custom', string> = {
  off: 'Real speed',
  'fast-4g': 'Fast 4G',
  'slow-4g': 'Slow 4G',
  '3g': '3G',
  'slow-3g': 'Slow 3G',
  custom: 'Custom',
}

const LOADING_LABELS: Record<LoadingStrategy, string> = {
  lazy: 'IntersectionObserver',
  native: 'Browser (loading="lazy")',
  eager: 'Eager',
}

export function Controls({ settings, onChange, onReload }: ControlsProps) {
  const stats = useStats()
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value })

  return (
    <div className="controls">
      <label className="field">
        <span>Network</span>
        <select
          value={settings.throttle}
          onChange={(e) => set('throttle', e.target.value as Settings['throttle'])}
        >
          {Object.entries(PRESET_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {settings.throttle === 'custom' && (
        <>
          <Range label="Latency" unit="ms" min={0} max={2000} step={50} value={settings.latency} onChange={(v) => set('latency', v)} />
          <Range label="Bandwidth" unit="kbit/s" min={50} max={20000} step={50} value={settings.kbps} onChange={(v) => set('kbps', v)} />
        </>
      )}

      <label className="field">
        <span>Lazy loading</span>
        <select value={settings.loading} onChange={(e) => set('loading', e.target.value as LoadingStrategy)}>
          {Object.entries(LOADING_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <Range
        label="Preload distance"
        unit="px"
        min={0}
        max={3000}
        step={50}
        value={settings.rootMargin}
        disabled={settings.loading !== 'lazy'}
        onChange={(v) => set('rootMargin', v)}
      />
      <Range label="Fade" unit="ms" min={0} max={2000} step={50} value={settings.fadeDuration} onChange={(v) => set('fadeDuration', v)} />

      <label className="field">
        <span>Inline placeholder</span>
        <select value={settings.placeholder} onChange={(e) => set('placeholder', e.target.value as PlaceholderMode)}>
          <option value="blur">Blurred thumbnail SVG</option>
          <option value="color">1px color SVG</option>
          <option value="none">None</option>
        </select>
      </label>

      <label className="field">
        <span>Formats</span>
        <select value={settings.formats} onChange={(e) => set('formats', e.target.value as Settings['formats'])}>
          <option value="webp">WebP → JPEG</option>
          <option value="avif">AVIF → WebP → JPEG</option>
        </select>
      </label>

      <div className="stats" aria-live="polite">
        {stats.loaded}/{stats.started} loaded · {(stats.bytes / 1024).toFixed(0)} KB
      </div>
      <button type="button" onClick={onReload}>
        Reload images
      </button>
    </div>
  )
}

interface RangeProps {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}

function Range({ label, unit, value, onChange, ...input }: RangeProps) {
  return (
    <label className="field">
      <span>
        {label} <output>{value} {unit}</output>
      </span>
      <input type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} {...input} />
    </label>
  )
}
