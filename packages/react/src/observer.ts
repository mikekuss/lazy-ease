type Callback = (isIntersecting: boolean) => void

interface Pool {
  observer: IntersectionObserver
  callbacks: Map<Element, Callback>
}

// One observer per rootMargin, shared by every image that uses it.
const pools = new Map<string, Pool>()

function getPool(rootMargin: string): Pool {
  let pool = pools.get(rootMargin)
  if (pool) return pool

  const callbacks = new Map<Element, Callback>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting)
    },
    // Inside nested scroll containers rootMargin does nothing along the scroll
    // axis (spec 7.1). Engines without scrollMargin ignore the unknown member.
    { rootMargin, scrollMargin: rootMargin } as IntersectionObserverInit,
  )
  pool = { observer, callbacks }
  pools.set(rootMargin, pool)
  return pool
}

/**
 * Reports every time `element` enters or leaves the zone `rootMargin` around
 * the viewport. Returns a function that stops observing.
 */
export function observeIntersection(element: Element, rootMargin: string, callback: Callback): () => void {
  const pool = getPool(rootMargin)
  pool.callbacks.set(element, callback)
  pool.observer.observe(element)
  return () => {
    pool.callbacks.delete(element)
    pool.observer.unobserve(element)
  }
}

export interface WhenVisibleOptions {
  rootMargin: string
  /** How long the element must stay in the zone before `callback` runs (spec 7.2). */
  dwellTime: number
}

/**
 * Calls `callback` once when `element` comes within `rootMargin` of the
 * viewport and stays there for `dwellTime` ms. Leaving earlier cancels the
 * wait. Returns a function that cancels the subscription.
 */
export function whenVisible(element: Element, { rootMargin, dwellTime }: WhenVisibleOptions, callback: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback()
    return () => {}
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    stop()
    callback()
  }
  const stop = observeIntersection(element, rootMargin, (isIntersecting) => {
    clearTimeout(timer)
    timer = undefined
    if (!isIntersecting) return
    if (dwellTime > 0) timer = setTimeout(fire, dwellTime)
    else fire()
  })
  return () => {
    clearTimeout(timer)
    stop()
  }
}

type ResizeCallback = (rect: DOMRectReadOnly) => void

// One ResizeObserver for every image, created on first use.
let resizePool: { observer: ResizeObserver; callbacks: Map<Element, ResizeCallback> } | undefined

/**
 * Reports the content box of `element` every time it changes size. Returns a
 * function that stops observing. Does nothing without `ResizeObserver`.
 */
export function observeResize(element: Element, callback: ResizeCallback): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  if (!resizePool) {
    const callbacks = new Map<Element, ResizeCallback>()
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.contentRect)
    })
    resizePool = { observer, callbacks }
  }
  const pool = resizePool
  pool.callbacks.set(element, callback)
  pool.observer.observe(element)
  return () => {
    pool.callbacks.delete(element)
    pool.observer.unobserve(element)
  }
}
