import { afterEach, describe, expect, it, vi } from 'vitest'

// Importing the ESM entries must not touch the DOM; only the self-starting
// script (src/auto.ts) does, by design. scripts/check-packages.mjs repeats
// this on the packed package without a process global.

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>
  }
}

const BROWSER_GLOBALS = ['document', 'window', 'navigator', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'matchMedia', 'Image', 'HTMLElement']

const restore: (() => void)[] = []
afterEach(() => {
  while (restore.length) restore.pop()!()
})

function trap(): string[] {
  const touched: string[] = []
  for (const name of BROWSER_GLOBALS) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, get: () => (touched.push(name), undefined) })
    restore.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    })
  }
  return touched
}

describe('import purity', () => {
  it.each(['../src/index.js', '../src/css.js'])('%s reads no browser global', async (path) => {
    vi.resetModules()
    const touched = trap()
    const module = (await import(path)) as Record<string, unknown>
    expect(Object.keys(module).length).toBeGreaterThan(0)
    expect(touched).toEqual([])
  })

  it('never names the Node process global', () => {
    const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources)).toHaveLength(3)
    for (const [file, code] of Object.entries(sources)) expect(code, file).not.toMatch(/process/)
  })
})
