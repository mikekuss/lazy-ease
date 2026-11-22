/**
 * Calls into the page's code: a state or display callback, a reveal, a deferred ThumbHash decode,
 * an observer's subscription.
 * Its error is reported as an event listener's is, from a timer, and changes nothing here:
 * the call returns undefined, and the image goes on as if the callback had done nothing.
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
