export interface NetworkProfile {
  /** Added before the first byte, in milliseconds. */
  latency: number
  /** Bandwidth in kilobits per second. */
  kbps: number
}

export const PRESETS = {
  off: null,
  'fast-4g': { latency: 40, kbps: 9000 },
  'slow-4g': { latency: 150, kbps: 1600 },
  '3g': { latency: 300, kbps: 750 },
  'slow-3g': { latency: 400, kbps: 400 },
} satisfies Record<string, NetworkProfile | null>

export type PresetName = keyof typeof PRESETS

/** Reads a profile from query params: `throttle=<preset>` or `latency=…&kbps=…`. */
export function profileFromQuery(query: Record<string, string | undefined>): NetworkProfile | null {
  const preset = query.throttle
  if (preset && preset in PRESETS) return PRESETS[preset as PresetName]
  const latency = Number(query.latency ?? 0)
  const kbps = Number(query.kbps ?? 0)
  if (kbps > 0) return { latency: Math.max(0, latency), kbps }
  return null
}
