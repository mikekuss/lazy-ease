import { useSyncExternalStore } from 'react'

// Tiny store for the counters in the control bar.
export interface Stats {
  started: number
  loaded: number
  bytes: number
}

let stats: Stats = { started: 0, loaded: 0, bytes: 0 }
const listeners = new Set<() => void>()

function update(next: Stats) {
  stats = next
  for (const listener of listeners) listener()
}

export const recordStart = () => update({ ...stats, started: stats.started + 1 })
export const recordLoad = (bytes: number) =>
  update({ ...stats, loaded: stats.loaded + 1, bytes: stats.bytes + bytes })
export const resetStats = () => update({ started: 0, loaded: 0, bytes: 0 })

export function useStats(): Stats {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => stats,
  )
}
