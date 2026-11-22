/**
 * Calls into the page's code: a state or display callback, a reveal, a deferred ThumbHash decode,
 * or an observer's subscription. Its error is reported as an event listener's is, from a timer, and
 * the call returns undefined. For a callback the image goes on as if it had done nothing; for a
 * subscription, what it did before it threw stays and the rest of the batch still runs.
 */
export const guard = <A extends unknown[], T>(callback: ((...args: A) => T) | undefined, ...args: A): T | undefined => {
  try {
    return callback?.(...args)
  } catch (error) {
    setTimeout(() => {
      throw error
    })
  }
}
