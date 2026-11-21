import { afterEach, describe, expect, it, vi } from 'vitest'

// Vite's glob import, typed here since core's tests compile without Vite or Node types.
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>
  }
}

// Importing core must not detect anything, touch the DOM, set up observers
// or compute ladders. scripts/check-packages.mjs repeats this on the packed
// package in plain Node, without a process global.

const BROWSER_GLOBALS = [
  'document',
  'window',
  'navigator',
  'IntersectionObserver',
  'ResizeObserver',
  'MutationObserver',
  'matchMedia',
  'Image',
  'requestAnimationFrame',
  'getComputedStyle',
  'devicePixelRatio',
  'HTMLElement',
  'localStorage',
]

const restore: (() => void)[] = []
afterEach(() => {
  while (restore.length) restore.pop()!()
  vi.restoreAllMocks()
})

function trap(names: readonly string[]): string[] {
  const touched: string[] = []
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        touched.push(name)
        return undefined
      },
    })
    restore.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    })
  }
  return touched
}

describe('import purity', () => {
  it.each(['../src/index.js', '../src/thumbhash.js', '../src/prepared.js'])('%s reads no browser global and computes nothing', async (path) => {
    vi.resetModules()
    const touched = trap(BROWSER_GLOBALS)
    const toFixed = vi.spyOn(Number.prototype, 'toFixed')
    const sort = vi.spyOn(Array.prototype, 'sort')
    const module = (await import(path)) as Record<string, unknown>
    expect(Object.keys(module).length).toBeGreaterThan(0)
    expect(touched).toEqual([])
    expect(toFixed).not.toHaveBeenCalled()
    expect(sort).not.toHaveBeenCalled()
  })

  it.each(['../src/index.js', '../src/prepared.js'])('%s creates an instance without touching the DOM', async (path) => {
    vi.resetModules()
    const { createLazyEase } = (await import(path)) as typeof import('../src/index.js')
    const touched = trap(BROWSER_GLOBALS)
    createLazyEase({ rootMargin: '200px' })
    expect(touched).toEqual([])
  })

  it('names the Node process global only in the guarded development checks of createLoader and measured mode', () => {
    const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(5)
    const guards: Record<string, string> = {
      '/loader.ts': "try {\n    if (process.env.NODE_ENV !== 'production') checkLadders(",
      '/dom/measure.ts': "try {\n    if (process.env.NODE_ENV !== 'production' && !o.detectFormat",
    }
    for (const [file, code] of Object.entries(sources)) {
      // Comments may name it; code may not, apart from the guards (inside
      // their try) and their declaration. Only whole comment lines and block
      // comments are dropped, so a `//` inside a string hides nothing.
      let rest = code.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const guard = Object.entries(guards).find(([name]) => file.endsWith(name))?.[1]
      if (guard) {
        expect(rest.split(guard).length, file).toBe(2)
        rest = rest.replace(guard, '').replace('declare const process: { env: { NODE_ENV?: string } }', '')
      }
      expect(rest, file).not.toMatch(/\bprocess\b/)
    }
  })
})
