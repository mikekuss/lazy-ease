import { whenVisible, type AttachOptions, type LazyEase } from '@lazy-ease/core'

export interface Enhancement {
  /** Destroys the attachments and background subscriptions this call made. Each element keeps what it displays. */
  destroy(): void
}

/** What `enhance` accepts as the area to scan. */
export type EnhanceRoot = Document | Element | ShadowRoot

// The claim core's controller sets on an attached img. Global, so every copy
// of the packages on the page sees it.
const CLAIM = Symbol.for('lazy-ease.attachment')
type Claims = Record<symbol, object | undefined>
const SELECTOR = '[data-le],[data-le-background]'

/**
 * The attach options the `data-le-*` attributes of `img` describe. Without
 * `data-le-src`, `data-le-srcset` or `data-le-url` the image is native: its
 * HTML sources are adopted as they are. The HTML `width` and `height` stay
 * plain dimensions; a measured crop ratio comes from `data-le-ar`. In a
 * `<picture>`, a deferred img needs deferred sources and a native img native
 * ones. Throws a TypeError for a malformed value or a mixed picture, before
 * anything touches the element.
 */
export function readOptions(img: HTMLImageElement): AttachOptions {
  const text = (name: string) => img.getAttribute(`data-le-${name}`) ?? undefined
  const number = (name: string, positive = true) => {
    const value = text(name)
    if (value === undefined) return
    if (!value.trim() || !isFinite(+value) || (positive && +value <= 0)) throw new TypeError(`[lazy-ease] data-le-${name}`)
    return +value
  }
  const crop = text('crop')
  if (crop !== undefined && crop !== 'server' && crop !== 'browser') throw new TypeError('[lazy-ease] data-le-crop')
  const x = number('fx', false)
  const y = number('fy', false)
  if ((x === undefined) !== (y === undefined)) throw new TypeError('[lazy-ease] data-le-fx/fy')
  const options: AttachOptions = {
    src: text('src'),
    srcset: text('srcset'),
    sizes: text('sizes'),
    url: text('url'),
    srcWidth: number('srcw'),
    srcHeight: number('srch'),
    aspectRatio: number('ar'),
    fill: img.hasAttribute('data-le-fill') || undefined,
    crop,
    focalPoint: x === undefined ? undefined : { x, y: y! },
    token: text('token'),
    version: text('v'),
    quality: number('q'),
  }
  const native = options.src === undefined && options.srcset === undefined && options.url === undefined
  const picture = img.parentElement
  if (picture?.tagName === 'PICTURE') {
    for (const source of picture.querySelectorAll(':scope>source')) {
      // An activated source keeps data-le-srcset next to its srcset.
      const deferred = source.hasAttribute('data-le-srcset')
      if (native ? deferred : !deferred && source.hasAttribute('srcset')) throw new TypeError('[lazy-ease] mixed picture')
    }
  }
  if (native) options.loading = 'native'
  return options
}

/**
 * Attaches `le` to every marked image under `root` (a document, element or
 * shadow root, the root itself included) and arms every decorative
 * `[data-le-background]`, which gets `data-le-visible` once it comes within
 * the instance's root margin. Skips elements another attachment, instance or
 * copy of the package already owns, so enhancing again, or from a second
 * bundle, is harmless. Skips subtrees whose nearest `data-le-auto` is `"off"`:
 * React and Lit attach their own images. A shadow tree under `root` is not
 * entered; enhance it on its own. An image whose attributes are invalid is
 * reported on the console and left alone; the others still attach. So is an
 * element marked both `data-le` and `data-le-background`.
 */
export function enhance(le: LazyEase, root: EnhanceRoot = document): Enhancement {
  const cleanups: (() => void)[] = []
  const elements = [...root.querySelectorAll(SELECTOR)]
  if ('matches' in root && root.matches(SELECTOR)) elements.unshift(root)
  for (const element of elements) {
    if (element.closest('[data-le-auto]')?.getAttribute('data-le-auto') === 'off') continue
    try {
      const cleanup = take(le, element)
      if (cleanup) cleanups.push(cleanup)
    } catch (error) {
      console.error(error, element)
    }
  }
  return { destroy: () => cleanups.splice(0).forEach((cleanup) => cleanup()) }
}

/** Attaches or arms one marked element. Returns its cleanup, or nothing when it is not this call's to take. */
function take(le: LazyEase, element: Element): (() => void) | undefined {
  if (element.hasAttribute('data-le-background')) {
    if (element.hasAttribute('data-le')) throw new TypeError('[lazy-ease] data-le with data-le-background')
    const claims = element as unknown as Claims
    if (element.hasAttribute('data-le-visible') || claims[CLAIM]) return
    const claim = (claims[CLAIM] = {})
    const release = () => {
      if (claims[CLAIM] === claim) delete claims[CLAIM]
    }
    try {
      const stop = whenVisible(element, le.config, () => {
        element.setAttribute('data-le-visible', '')
        release()
      })
      return () => {
        stop()
        release()
      }
    } catch (error) {
      // An observer that cannot be built leaves no claim behind.
      release()
      throw error
    }
  }
  const img = element.tagName === 'IMG' ? (element as HTMLImageElement) : element.querySelector('img')
  // An img inside a nested box belongs to that box.
  if (!img || img.closest('[data-le]') !== element || (img as unknown as Claims)[CLAIM]) return
  return le.attach(img, readOptions(img)).destroy
}
