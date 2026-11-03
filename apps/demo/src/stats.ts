import { useSyncExternalStore } from 'react'

// Tiny store for the totals in the control bar, fed by every DemoImage.
export interface ImageRecord {
  state: string
  /** Body bytes of the image on screen. */
  bytes?: number
  /** Body bytes the `sizes="100vw"` candidate would have had. */
  naiveBytes?: number
}

export interface Totals {
  started: number
  loaded: number
  bytes: number
  /** Over the images that have both numbers, so the comparison is like for like. */
  compared: { bytes: number; naiveBytes: number }
}

const records = new Map<string, ImageRecord>()
const listeners = new Set<() => void>()
let totals: Totals = summarize()

function summarize(): Totals {
  const next: Totals = { started: 0, loaded: 0, bytes: 0, compared: { bytes: 0, naiveBytes: 0 } }
  for (const record of records.values()) {
    if (record.state !== 'idle') next.started++
    if (record.state === 'loaded') next.loaded++
    next.bytes += record.bytes ?? 0
    if (record.bytes !== undefined && record.naiveBytes !== undefined) {
      next.compared.bytes += record.bytes
      next.compared.naiveBytes += record.naiveBytes
    }
  }
  return next
}

function changed() {
  totals = summarize()
  for (const listener of listeners) listener()
}

export function updateRecord(id: string, patch: Partial<ImageRecord>): void {
  records.set(id, { state: 'idle', ...records.get(id), ...patch })
  changed()
}

export function removeRecord(id: string): void {
  if (records.delete(id)) changed()
}

export function useTotals(): Totals {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => totals,
  )
}
