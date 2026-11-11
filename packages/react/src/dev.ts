const warned = new Set<string>()

/** Logs a development warning once per key, so re-renders and lists don't flood the console. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[lazy-ease] ${message}`)
}

/** Forgets which warnings were logged. For tests. */
export function resetWarnings(): void {
  warned.clear()
}
