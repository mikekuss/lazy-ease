// Browser APIs jsdom lacks, for the component tests. The observers, the
// format probe and matchMedia are the controller's own mocks from core.
import { act } from '@testing-library/react'
import { vi } from 'vitest'
import * as core from '../../core/test/dom-mocks.js'

export { media, MockIntersectionObserver, MockResizeObserver, probe } from '../../core/test/dom-mocks.js'

/** What the next decode() of any image does. */
export const decoding = { behavior: 'resolve' as 'resolve' | 'reject' | 'hang' }

interface Loading {
  complete?: boolean
  naturalWidth?: number
  currentSrc?: string
}
const loading = new WeakMap<HTMLImageElement, Loading>()

/**
 * jsdom loads nothing. Every img starts incomplete; `currentSrc` follows the
 * src attribute until the test loads it with `load`.
 */
export function installDom(): void {
  core.installDom()
  const prototype = HTMLImageElement.prototype
  const field = <K extends keyof Loading>(name: K, fallback: (img: HTMLImageElement) => Loading[K]) =>
    Object.defineProperty(prototype, name, {
      configurable: true,
      get(this: HTMLImageElement) {
        return loading.get(this)?.[name] ?? fallback(this)
      },
      set(this: HTMLImageElement, value: Loading[K]) {
        loading.set(this, { ...loading.get(this), [name]: value })
      },
    })
  field('complete', () => false)
  field('naturalWidth', () => 0)
  field('currentSrc', (img) => img.getAttribute('src') ?? '')
  prototype.decode = () =>
    decoding.behavior === 'hang' ? new Promise(() => {}) : decoding.behavior === 'reject' ? Promise.reject(new Error('EncodingError')) : Promise.resolve()
  vi.stubGlobal('innerWidth', 1024)
  vi.stubGlobal('innerHeight', 768)
}

export function resetDom(): void {
  decoding.behavior = 'resolve'
}

/** Marks `img` as already loaded from `url`, as a cached image is before hydration. */
export function complete(img: HTMLImageElement, url = img.getAttribute('src') ?? '', naturalWidth = 100): void {
  Object.assign(img, { complete: true, naturalWidth, currentSrc: url })
}

/** The element enters (or leaves) the preload zone. */
export const intersect = (element: Element, isIntersecting = true) => act(() => core.intersect(element, isIntersecting))

/** The element's content box gets a size. */
export const resize = (element: Element, width: number, height: number) => act(() => core.resize(element, width, height))

/** The browser loaded the selected source of `img`. */
export const load = (img: HTMLImageElement, url?: string) => act(() => core.load(img, url))

/** The selected source of `img` failed. */
export const fail = (img: HTMLImageElement) => act(() => core.fail(img))

/** Lets timers and promises run, inside act(). */
export async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
