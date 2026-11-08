// Browser APIs jsdom lacks, driven by the controller tests.
import { vi } from 'vitest'

export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly elements = new Set<Element>()
  disconnected = false
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit & { scrollMargin?: string } = {},
  ) {
    MockIntersectionObserver.instances.push(this)
  }
  observe(element: Element) {
    this.elements.add(element)
  }
  unobserve(element: Element) {
    this.elements.delete(element)
  }
  disconnect() {
    this.disconnected = true
    this.elements.clear()
  }
}

/** Reports `element` entering (or leaving) the zone to every observer watching it. */
export function intersect(element: Element, isIntersecting = true): void {
  for (const observer of MockIntersectionObserver.instances) {
    if (!observer.elements.has(element)) continue
    observer.callback([{ target: element, isIntersecting } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
  }
}

export class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  readonly elements = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this)
  }
  observe(element: Element) {
    this.elements.add(element)
  }
  unobserve(element: Element) {
    this.elements.delete(element)
  }
  disconnect() {
    this.elements.clear()
  }
}

/** Reports a content-box size for `element`, as a real ResizeObserver does. */
export function resize(element: Element, width: number, height: number): void {
  for (const observer of MockResizeObserver.instances) {
    if (!observer.elements.has(element)) continue
    const entry = { target: element, contentRect: { width, height } } as unknown as ResizeObserverEntry
    observer.callback([entry], observer as unknown as ResizeObserver)
  }
}

export const media = { reducedMotion: false }

/** What the format probe's images report: whether each data URI decodes. */
export const probe = { avif: true, webp: true, created: 0, hang: false }

class MockImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  width = 0
  constructor() {
    probe.created++
  }
  set src(uri: string) {
    if (probe.hang) return
    const ok = uri.startsWith('data:image/avif') ? probe.avif : probe.webp
    queueMicrotask(() => {
      this.width = ok ? 1 : 0
      ;(ok ? this.onload : this.onerror)?.()
    })
  }
}

export function installDom(): void {
  MockIntersectionObserver.instances = []
  MockResizeObserver.instances = []
  media.reducedMotion = false
  Object.assign(probe, { avif: true, webp: true, created: 0, hang: false })
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.stubGlobal('Image', MockImage)
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') && media.reducedMotion }))
}

export interface FakeImage {
  /** Lets the next decode() resolve, reject or hang. */
  decodeWith: 'resolve' | 'reject' | 'hang'
  decodes: number
}

/**
 * Gives `img` the parts of a loading image jsdom doesn't have: `complete`,
 * `naturalWidth`, `currentSrc` and `decode()`.
 */
export function fakeImage(img: HTMLImageElement): FakeImage {
  const state: FakeImage = { decodeWith: 'resolve', decodes: 0 }
  Object.defineProperties(img, {
    complete: { value: false, writable: true, configurable: true },
    naturalWidth: { value: 0, writable: true, configurable: true },
    currentSrc: { value: img.getAttribute('src') ?? '', writable: true, configurable: true },
    decode: {
      configurable: true,
      value: () => {
        state.decodes++
        if (state.decodeWith === 'hang') return new Promise(() => {})
        return state.decodeWith === 'resolve' ? Promise.resolve() : Promise.reject(new Error('EncodingError'))
      },
    },
  })
  return state
}

const firstCandidate = (srcset: string) => srcset.split(',')[0]!.trim().split(' ')[0]!

/** The browser finished loading the selected source of `img` (or `url`). */
export function load(img: HTMLImageElement, url?: string): void {
  const srcset = img.getAttribute('srcset')
  Object.assign(img, {
    complete: true,
    naturalWidth: 100,
    currentSrc: url ?? (srcset ? firstCandidate(srcset) : (img.getAttribute('src') ?? '')),
  })
  img.dispatchEvent(new Event('load'))
}

/** The selected source of `img` failed. */
export function fail(img: HTMLImageElement): void {
  Object.assign(img, { complete: true, naturalWidth: 0 })
  img.dispatchEvent(new Event('error'))
}

/** Lets pending promises (decode, format detection) settle under fake timers. */
export const flush = () => vi.advanceTimersByTimeAsync(0)
