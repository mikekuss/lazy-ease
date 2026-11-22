import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { FullConfig } from '@playwright/test'

// Playwright reuses servers that already answer on the configured ports, and
// another worktree's `pnpm dev` may hold them. Both the Vite server and the
// image server it proxies to say which checkout they run from; a green run
// against someone else's code would prove nothing.
const expected = path.resolve(import.meta.dirname, '..', '..', 'demo')

/** Whether two paths name the same directory; a path that no longer exists (a deleted worktree) names none. */
export const same = (a: string, b: string) => {
  const norm = (p: string) => {
    const real = realpathSync.native(p)
    return process.platform === 'win32' ? real.toLowerCase() : real
  }
  try {
    return norm(a) === norm(b)
  } catch {
    return false
  }
}

export default async function identity(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  for (const [what, url] of [
    ['Vite (PORT)', new URL('/__identity', baseURL)],
    ['the image server (SERVER_PORT)', new URL('/api/identity', baseURL)],
  ] as const) {
    const response = await fetch(url).catch(() => undefined)
    const dir = response?.ok ? ((await response.json()) as { dir?: string }).dir : undefined
    if (!dir || !same(dir, expected)) {
      throw new Error(
        `${what} behind ${baseURL} runs from ${dir ?? 'an unknown checkout'}, not ${expected}. ` +
          'Stop that server, or set PORT and SERVER_PORT to free ports.',
      )
    }
  }
}
