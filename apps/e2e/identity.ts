import type { FullConfig } from '@playwright/test'
import { same } from './frames/identity.js'

// Playwright reuses a server that already answers on E2E_PORT, and another
// worktree's `pnpm e2e` may hold it. The server says which checkout it runs
// from; a green run against someone else's code would prove nothing.
const expected = import.meta.dirname

export default async function identity(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const response = await fetch(new URL('/identity', baseURL)).catch(() => undefined)
  const dir = response?.ok ? ((await response.json()) as { dir?: string }).dir : undefined
  if (!dir || !same(dir, expected)) {
    throw new Error(`The e2e server behind ${baseURL} runs from ${dir ?? 'an unknown checkout'}, not ${expected}. Stop that server, or set E2E_PORT to a free port.`)
  }
}
