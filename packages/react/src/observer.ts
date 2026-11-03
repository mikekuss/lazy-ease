type Callback = () => void

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
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = callbacks.get(entry.target)
        callbacks.delete(entry.target)
        observer.unobserve(entry.target)
        callback?.()
      }
    },
    { rootMargin },
  )
  pool = { observer, callbacks }
  pools.set(rootMargin, pool)
  return pool
}

/**
 * Calls `callback` once when `element` comes within `rootMargin` of the
 * viewport. Returns a function that cancels the subscription.
 */
export function whenVisible(element: Element, rootMargin: string, callback: Callback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback()
    return () => {}
  }

  const pool = getPool(rootMargin)
  pool.callbacks.set(element, callback)
  pool.observer.observe(element)
  return () => {
    pool.callbacks.delete(element)
    pool.observer.unobserve(element)
  }
}
