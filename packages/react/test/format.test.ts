import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DETECTION_TIMEOUT, detectFormat, resetFormatDetection, resolvedFormat, startFormatDetection } from '../src/format.js'

type Outcome = 'load' | 'error' | 'hang'

/** Stubs `document` and `Image` so decoding each test image ends as given. */
function fakeBrowser(outcomes: { avif: Outcome; webp: Outcome }) {
  const created: string[] = []
  class FakeImage {
    width = 0
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(uri: string) {
      created.push(uri)
      const outcome = uri.startsWith('data:image/avif') ? outcomes.avif : outcomes.webp
      queueMicrotask(() => {
        if (outcome === 'load') {
          this.width = 1
          this.onload?.()
        } else if (outcome === 'error') {
          this.onerror?.()
        }
      })
    }
  }
  vi.stubGlobal('document', {})
  vi.stubGlobal('Image', FakeImage)
  return created
}

beforeEach(() => resetFormatDetection())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetFormatDetection()
})

describe('format detection', () => {
  it('resolves to webp outside a browser without touching the DOM', async () => {
    expect(typeof document).toBe('undefined')
    await expect(startFormatDetection()).resolves.toBe('webp')
    await expect(detectFormat()).resolves.toBe('webp')
  })

  it('prefers avif', async () => {
    fakeBrowser({ avif: 'load', webp: 'load' })
    await expect(detectFormat()).resolves.toBe('avif')
  })

  it('falls back to webp, then jpeg', async () => {
    fakeBrowser({ avif: 'error', webp: 'load' })
    await expect(detectFormat()).resolves.toBe('webp')
    resetFormatDetection()
    fakeBrowser({ avif: 'error', webp: 'error' })
    await expect(detectFormat()).resolves.toBe('jpeg')
  })

  it('treats a zero-width load as unsupported', async () => {
    const created: string[] = []
    class ZeroWidth {
      width = 0
      onload: (() => void) | null = null
      set src(uri: string) {
        created.push(uri)
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('document', {})
    vi.stubGlobal('Image', ZeroWidth)
    await expect(detectFormat()).resolves.toBe('jpeg')
    expect(created).toHaveLength(2)
  })

  it('runs the decode test once per page', async () => {
    const created = fakeBrowser({ avif: 'load', webp: 'load' })
    const first = startFormatDetection()
    expect(startFormatDetection()).toBe(first)
    await Promise.all([detectFormat(), detectFormat(), first])
    expect(created).toHaveLength(1)
    expect(created[0]).toMatch(/^data:image\/avif;base64,/)
  })

  it('resolves to webp after 200 ms when detection hangs', async () => {
    vi.useFakeTimers()
    fakeBrowser({ avif: 'hang', webp: 'hang' })
    let result: string | undefined
    void detectFormat().then((format) => (result = format))
    await vi.advanceTimersByTimeAsync(DETECTION_TIMEOUT - 1)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe('webp')
  })

  it('returns the cached result once detection has finished', async () => {
    fakeBrowser({ avif: 'load', webp: 'load' })
    await startFormatDetection()
    vi.useFakeTimers()
    await expect(detectFormat()).resolves.toBe('avif')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('exposes the result synchronously once known', async () => {
    fakeBrowser({ avif: 'error', webp: 'load' })
    const pending = startFormatDetection()
    expect(resolvedFormat()).toBeUndefined()
    await pending
    await Promise.resolve()
    expect(resolvedFormat()).toBe('webp')
  })

  it('starts over after a reset', async () => {
    fakeBrowser({ avif: 'load', webp: 'load' })
    await expect(detectFormat()).resolves.toBe('avif')
    await Promise.resolve()
    expect(resolvedFormat()).toBe('avif')
    resetFormatDetection()
    expect(resolvedFormat()).toBeUndefined()
    fakeBrowser({ avif: 'error', webp: 'load' })
    await expect(detectFormat()).resolves.toBe('webp')
  })
})
