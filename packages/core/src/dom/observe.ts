type Root = Element | Document | null
type Callback = (...args: any[]) => void

interface Pool {
  /** null for the viewport; undefined for the ResizeObserver pool. */
  root?: Root
  margin?: string
  observer: { observe(target: Element): void; unobserve(target: Element): void; disconnect(): void }
  callbacks: Callbacks
}
type Callbacks = Map<Element, Set<Callback>>

// One IntersectionObserver per root and margin and one ResizeObserver,
// created on first use and disconnected once nothing observes through them.
const pools: Pool[] = []

function observe(root: Root | undefined, margin: string | undefined, element: Element, callback: Callback, create: (callbacks: Callbacks) => Pool['observer']): () => void {
  let pool = pools.find((p) => p.root === root && p.margin === margin)
  if (!pool) {
    const callbacks: Callbacks = new Map()
    pools.push((pool = { root, margin, callbacks, observer: create(callbacks) }))
  }
  const { observer, callbacks } = pool
  // Its own identity, so the same callback can subscribe twice.
  const subscription: Callback = (...args) => callback(...args)
  let set = callbacks.get(element)
  if (set) observer.unobserve(element)
  else callbacks.set(element, (set = new Set()))
  set.add(subscription)
  // Observing again queues a new initial entry, which the new subscription needs.
  observer.observe(element)
  return () => {
    if (!set.delete(subscription) || set.size) return
    callbacks.delete(element)
    observer.unobserve(element)
    if (!callbacks.size) {
      observer.disconnect()
      pools.splice(pools.indexOf(pool), 1)
    }
  }
}

export interface WhenVisibleOptions {
  /** The scrolling element to observe against. Default: the viewport. */
  root?: Element | Document | null
  /** How far outside the root to start, as a CSS margin. Default `'400px'`. */
  rootMargin?: string
  /** How long the element must stay in the zone before `callback` runs, in ms. Default 0. */
  dwellTime?: number
}

/**
 * Calls `callback` once when `element` comes within `rootMargin` of the
 * root and stays there for `dwellTime` ms. Leaving earlier cancels the wait.
 * Returns a function that cancels the subscription; other subscriptions
 * for the same element keep running. Elements with the same
 * root and margin share one IntersectionObserver. Without
 * IntersectionObserver the callback runs at once.
 */
export function whenVisible(element: Element, { root = null, rootMargin = '400px', dwellTime = 0 }: WhenVisibleOptions, callback: () => void): () => void {
  if (typeof IntersectionObserver != 'function') {
    callback()
    return () => {}
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    stop()
    callback()
  }
  const stop = observe(
    root,
    rootMargin,
    element,
    (hit: boolean) => {
      // A repeated entry for a subscription that joins later keeps the wait going.
      if (!hit) clearTimeout(timer), (timer = undefined)
      else if (!timer) dwellTime > 0 ? (timer = setTimeout(fire, dwellTime)) : fire()
    },
    (callbacks) =>
      new IntersectionObserver(
        (entries) => {
          for (const entry of entries) callbacks.get(entry.target)?.forEach((callback) => callback(entry.isIntersecting))
        },
        // Inside nested scroll containers rootMargin does nothing along the
        // scroll axis; scrollMargin does. Engines without it ignore the member.
        { root, rootMargin, scrollMargin: rootMargin } as IntersectionObserverInit,
      ),
  )
  return () => {
    clearTimeout(timer)
    stop()
  }
}

/**
 * Reports the content-box size of `element` every time it changes, starting
 * with its current size. Returns a function that stops observing. Does
 * nothing without ResizeObserver.
 */
export function observeResize(element: Element, callback: (width: number, height: number) => void): () => void {
  if (typeof ResizeObserver != 'function') return () => {}
  return observe(undefined, undefined, element, callback, (callbacks) =>
    new ResizeObserver((entries) => {
      // contentRect is the content box in physical width and height.
      for (const { target, contentRect } of entries) callbacks.get(target)?.forEach((callback) => callback(contentRect.width, contentRect.height))
    }),
  )
}

/** Forgets every pool without disconnecting it. For tests. */
export function resetObservers(): void {
  pools.length = 0
}
