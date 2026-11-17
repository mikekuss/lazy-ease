import { createLoader } from '@lazy-ease/core'
import { useEffect, useState } from 'react'
import { CARD, DENIED, HERO } from '../catalog'

// Canonical URLs without demo parameters, so the server sees them as they are.
const loader = createLoader()
const request = { width: 640, quality: 75, format: 'webp' as const }
const ALLOWED = loader.url({ ...request, src: HERO.mobile.src, ...HERO.mobile.crop })
const DENIED_URL = loader.url({ ...request, src: HERO.mobile.src, ...DENIED })
const TARGET = loader.url({ ...request, src: CARD.src })
// Other variants of the same source, enough to push the target out of the small storage's per-source quota.
const FILL = [750, 828, 1080, 1200, 1440].map((width) => loader.url({ ...request, src: CARD.src, width }))

interface Line {
  text: string
  tone?: 'ok' | 'error'
}

async function probe(url: string): Promise<{ status: number; cache: string | null; ms: number }> {
  const started = performance.now()
  const response = await fetch(url, { cache: 'no-store' })
  await response.arrayBuffer()
  return { status: response.status, cache: response.headers.get('X-Demo-Cache'), ms: Math.round(performance.now() - started) }
}

/** Admission and storage of the live server: a denied crop, a cache hit, eviction and the render after it. */
export function Backend() {
  const [crops, setCrops] = useState<Line[]>([])
  const [log, setLog] = useState<Line[]>([])
  const [preset, setPreset] = useState('disk')
  const [presets, setPresets] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const storage = () =>
    fetch('/api/storage')
      .then((response) => response.json() as Promise<{ preset: string; presets: string[] }>)
      .then((state) => {
        setPreset(state.preset)
        setPresets(state.presets)
      })
  useEffect(() => void storage(), [])

  const add = (line: Line) => setLog((lines) => [line, ...lines].slice(0, 8))
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      // Waits for background writes, so the next request sees them.
      await storage()
      setBusy(false)
    }
  }

  const checkCrops = () =>
    run(async () => {
      const lines: Line[] = []
      for (const [label, url] of [
        ['focus 30/45, listed', ALLOWED],
        ['focus 80/20, no token', DENIED_URL],
      ] as const) {
        const { status } = await probe(url)
        lines.push({ text: `${label} → ${status}`, tone: status === 200 ? 'ok' : 'error' })
      }
      setCrops(lines)
    })

  const fetchTarget = () =>
    run(async () => {
      const { status, cache, ms } = await probe(TARGET)
      const what = status !== 200 ? `${status}` : cache === 'hit' ? 'hit' : 'rendered'
      add({ text: `w640 · ${what} · ${ms} ms`, tone: cache === 'hit' ? 'ok' : undefined })
    })

  const fill = () =>
    run(async () => {
      for (const url of FILL) await probe(url)
      add({ text: `${FILL.length} other widths stored` })
    })

  const switchPreset = (next: string) =>
    run(async () => {
      await fetch('/api/storage', { method: 'PUT', body: JSON.stringify({ preset: next }), headers: { 'Content-Type': 'application/json' } })
      setLog([])
    })

  return (
    <div className="backend">
      <div>
        <h3>Crop admission</h3>
        <button type="button" disabled={busy} onClick={() => void checkCrops()}>
          Request both
        </button>
        <ul className="log">
          {crops.map((line) => (
            <li key={line.text} className={line.tone}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Storage</h3>
        <div className="inline-controls">
          <label className="field">
            <span>Preset</span>
            <select value={preset} disabled={busy} onChange={(e) => void switchPreset(e.target.value)}>
              {presets.map((name) => (
                <option key={name} value={name}>
                  {PRESET_LABELS[name] ?? name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void fetchTarget()}>
            Request w640
          </button>
          <button type="button" disabled={busy || preset !== 'small'} onClick={() => void fill()} title="Small preset only">
            Evict
          </button>
        </div>
        <ul className="log">
          {log.map((line, i) => (
            <li key={log.length - i} className={line.tone}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const PRESET_LABELS: Record<string, string> = {
  disk: 'Disk, 1 GB',
  small: 'Disk, 2 MB',
  memory: 'Memory',
  off: 'Off',
}
