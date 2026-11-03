// Browser APIs jsdom lacks or fakes, driven by the component tests.
import { act } from '@testing-library/react'
import { vi } from 'vitest'

interface Rect {
  width: number
  height: number
  top: number
  left: number
}

/** Size and position every element reports, unless set per element. Off-screen by default. */
export const defaultRect: Rect = { width: 300, height: 200, top: 2000, left: 0 }
const rects = new WeakMap<Element, Partial<Rect>>()

export function setRect(element: Element, rect: Partial<Rect>): void {
  rects.set(element, { ...rects.get(element), ...rect })
}

function rectOf(element: Element): DOMRect {
  const { width, height, top, left } = { ...defaultRect, ...rects.get(element) }
  return { width, height, top, left, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) }
}

export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly elements = new Set<Element>()
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
    this.elements.clear()
  }
}

/** Reports `element` entering (or leaving) the preload zone to every observer watching it. */
export function intersect(element: Element, isIntersecting = true): void {
  act(() => {
    for (const observer of MockIntersectionObserver.instances) {
      if (!observer.elements.has(element)) continue
      const entry = { target: element, isIntersecting } as IntersectionObserverEntry
      observer.callback([entry], observer as unknown as IntersectionObserver)
    }
  })
}

/** The rect minus padding and border, as a real ResizeObserver reports it. */
function contentRectOf(element: Element): DOMRect {
  const rect = rectOf(element)
  const style = getComputedStyle(element)
  const px = (...values: string[]) => values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
  const width = rect.width - px(style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth)
  const height = rect.height - px(style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth)
  return { ...rect, width, height, right: rect.left + width, bottom: rect.top + height }
}

export class MockResizeObserver {
  static instances = new Set<MockResizeObserver>()
  readonly elements = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.add(this)
  }
  observe(element: Element) {
    this.elements.add(element)
  }
  unobserve(element: Element) {
    this.elements.delete(element)
  }
  disconnect() {
    this.elements.clear()
    MockResizeObserver.instances.delete(this)
  }
}

/** Gives `element` a new size and notifies the resize observers watching it. */
export function resize(element: Element, rect: Partial<Rect>): void {
  setRect(element, rect)
  act(() => {
    for (const observer of MockResizeObserver.instances) {
      if (!observer.elements.has(element)) continue
      const entry = { target: element, contentRect: contentRectOf(element) } as unknown as ResizeObserverEntry
      observer.callback([entry], observer as unknown as ResizeObserver)
    }
  })
}

/** Lets timers and promises run, inside act(). */
export async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

export const media = { reducedMotion: false }

type DecodeBehavior = 'resolve' | 'reject' | 'hang'
export const decoding = { behavior: 'resolve' as DecodeBehavior }

/** Format detection in tests: AVIF decodes unless `formatDetection.hang` is set. */
export const formatDetection = { hang: false }

class FakeDetectionImage {
  width = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_uri: string) {
    if (formatDetection.hang) return
    queueMicrotask(() => {
      this.width = 1
      this.onload?.()
    })
  }
}
export const detectionImage = { created: 0 }

function largestCandidate(srcset: string | null): string {
  if (!srcset) return ''
  const candidates = srcset.split(', ')
  return candidates[candidates.length - 1]!.split(' ')[0]!
}

export function installDom(): void {
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduced-motion') && media.reducedMotion,
    media: query,
  })) as unknown as typeof window.matchMedia
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return rectOf(this)
  }

  const img = HTMLImageElement.prototype
  img.decode = function () {
    if (decoding.behavior === 'reject') return Promise.reject(new Error('decode failed'))
    if (decoding.behavior === 'hang') return new Promise(() => {})
    return Promise.resolve()
  }
  // jsdom loads nothing: images are never complete, and currentSrc follows
  // the attributes as if the browser picked the largest candidate.
  Object.defineProperty(img, 'complete', { configurable: true, get: () => false })
  Object.defineProperty(img, 'currentSrc', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? largestCandidate(this.getAttribute('srcset'))
    },
  })

  vi.stubGlobal(
    'Image',
    class extends FakeDetectionImage {
      constructor() {
        super()
        detectionImage.created++
      }
    },
  )
}

export function resetDom(): void {
  media.reducedMotion = false
  decoding.behavior = 'resolve'
  formatDetection.hang = false
  detectionImage.created = 0
  Object.assign(defaultRect, { width: 300, height: 200, top: 2000, left: 0 })
}
