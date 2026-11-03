import type { LoadingStrategy } from 'lazy-ease'
import type { PlaceholderKind, Settings } from './settings'
import { useTotals } from './stats'
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
  lazy: 'lazy (IntersectionObserver)',
  native: 'native (loading="lazy")',
  eager: 'eager',
}

const PLACEHOLDER_LABELS: Record<PlaceholderKind, string> = {
  thumbhash: 'ThumbHash',
  color: 'Dominant color',
  none: 'None',
}

const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`)

export function Controls({ settings, onChange, onReload }: ControlsProps) {
  const totals = useTotals()
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value })
  const { bytes, naiveBytes } = totals.compared
  const saved = naiveBytes > 0 ? Math.round((1 - bytes / naiveBytes) * 100) : undefined

  return (
    <div className="controls">
      <Select label="Network" value={settings.throttle} labels={PRESET_LABELS} onChange={(v) => set('throttle', v)} />
      {settings.throttle === 'custom' && (
        <>
          <Range label="Latency" unit="ms" min={0} max={2000} step={50} value={settings.latency} onChange={(v) => set('latency', v)} />
          <Range label="Bandwidth" unit="kbit/s" min={50} max={20000} step={50} value={settings.kbps} onChange={(v) => set('kbps', v)} />
        </>
      )}
      <Select label="Loading" value={settings.loading} labels={LOADING_LABELS} onChange={(v) => set('loading', v)} />
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
      <Range
        label="Dwell time"
        unit="ms"
        min={0}
        max={1000}
        step={50}
        value={settings.dwellTime}
        disabled={settings.loading !== 'lazy'}
        onChange={(v) => set('dwellTime', v)}
      />
      <Range label="Fade" unit="ms" min={0} max={2000} step={50} value={settings.fadeDuration} onChange={(v) => set('fadeDuration', v)} />
      <Select label="Placeholder" value={settings.placeholder} labels={PLACEHOLDER_LABELS} onChange={(v) => set('placeholder', v)} />
      <Select
        label="Loader formats"
        value={settings.formats}
        labels={{ avif: 'AVIF → WebP → JPEG', webp: 'WebP → JPEG' }}
        onChange={(v) => set('formats', v)}
      />

      <div className="stats" aria-live="polite">
        <span>
          {totals.loaded}/{totals.started} loaded · {mb(totals.bytes)}
        </span>
        {saved !== undefined && (
          <span title='Images with a known size, compared with a sizes="100vw" srcset'>
            {mb(bytes)} vs. {mb(naiveBytes)} with 100vw ({saved >= 0 ? `−${saved}` : `+${-saved}`} %)
          </span>
        )}
      </div>
      <button type="button" onClick={onReload} title="New URLs for every image, so the browser cache is cold">
        Reload images
      </button>
    </div>
  )
}

interface SelectProps<T extends string> {
  label: string
  value: T
  labels: Record<T, string>
  onChange: (value: T) => void
}

function Select<T extends string>({ label, value, labels, onChange }: SelectProps<T>) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {(Object.entries(labels) as [T, string][]).map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
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
