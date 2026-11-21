import { candidateSet } from '../candidates.js'
import { normalizeLoader, snapQuality, type ImageFormat } from '../loader.js'
import { snapRatio } from '../ratios.js'
import { focusStyles, type StyleRecord } from '../styles.js'
import { measuredCandidates, snapWidth } from '../widths.js'
import { createController, type LazyEase, type LazyEaseConfig, type Measure, type Timer } from './controller.js'
import { pickFormat } from './format.js'
import { observeResize } from './observe.js'

declare const process: { env: { NODE_ENV?: string } }
let warned = false

/** Sets `styles` on `element` and returns what puts the replaced values back. */
const assign = (element: HTMLElement, styles: StyleRecord) => {
  const style = element.style as unknown as Record<string, string>
  const before: Record<string, string> = {}
  for (const property in styles) before[property] = style[property]!
  Object.assign(style, styles)
  return () => Object.assign(style, before)
}

const measure: Measure = (src, o, mode, focus, img, box, surface, live, later, cancel, cleanups, install) => {
  const loader = normalizeLoader(o.loader!)
  const quality = snapQuality(o.quality!, loader.qualities)
  const { srcWidth, srcHeight } = o
  const declared = mode === 'fixed' ? o.width! / o.height! : o.aspectRatio
  const sourceRatio = srcWidth && srcHeight ? srcWidth / srcHeight : undefined
  const browserCrop = mode !== 'intrinsic' && (o.crop ? o.crop === 'browser' : mode === 'fill' && declared === undefined && !!sourceRatio)
  const candidates = (slot: number) => measuredCandidates({ measuredWidth: slot, ladder: loader.widths, srcWidth })
  // The candidate a browser at this DPR takes for a slot.
  const selected = (slot: number) => Math.min(snapWidth(slot * (devicePixelRatio || 1), loader.widths), candidates(slot).at(-1)!)
  let current: { slot: number; ratio?: number } | undefined
  let format: ImageFormat | 'auto'
  let timer: Timer | undefined
  let unfocus = () => {}

  const resize = (width: number, height: number) => {
    // Hidden or collapsed slots stay as they are until they get a size.
    if (!live() || !(width > 0) || (mode === 'fill' && !(height > 0))) return
    // Without a declared ratio a server-cropped fill takes the box's.
    const ratio = browserCrop || mode === 'intrinsic' ? undefined : snapRatio(declared ?? width / height, loader.ratios)
    const served = browserCrop ? sourceRatio : ratio
    // The cover width: the image is wider than the box when the box is relatively taller.
    let slot = Math.ceil(served ? Math.max(width, height * served) : width)
    if (current) {
      if (ratio === current.ratio && !(slot > current.slot && selected(slot) > selected(current.slot))) return
      slot = Math.max(slot, current.slot)
    }
    current = { slot, ratio }
    const set = candidateSet({
      widths: candidates(slot),
      srcWidth,
      srcHeight,
      // A call that ends the generation stops the calls for the other candidates.
      loader: { url: (request) => (live() ? loader.url(request) : '') },
      src,
      aspectRatio: ratio,
      focalPoint: ratio ? focus : undefined,
      quality,
      format,
      version: o.version,
      token: o.token,
    })
    // The loader can update() or destroy().
    if (!live()) return
    if (focus) {
      // A re-measure replaces the previous crop’s styles.
      unfocus()
      const styles = focusStyles({ focus, crop: ratio, srcWidth, srcHeight })
      const undo = [assign(img, styles.img), box && assign(box, styles.box)]
      unfocus = () => undo.forEach((callback) => callback?.())
    }
    install(set.srcset, `${slot}px`, set.srcset ? undefined : set.src)
  }

  const start = (chosen: ImageFormat | 'auto') => {
    if (!live()) return
    format = chosen
    cleanups.push(
      observeResize(surface, (width, height) => {
        // The first size counts at once; later ones once a resize settles.
        if (!current) return resize(width, height)
        cancel(timer)
        timer = later(() => resize(width, height), 200)
      }),
    )
  }
  const { formats } = loader
  // A development hint, dropped by production bundles; without a bundler, reading `process` throws and skips it.
  try {
    if (process.env.NODE_ENV !== 'production' && !o.detectFormat && formats !== 'auto' && formats.includes('avif') && pickFormat(formats) !== 'avif' && !warned) {
      warned = true
      console.warn(`[lazy-ease] The loader declares AVIF, but without detectFormat measured images request ${pickFormat(formats)}. Pass detectFormat: detectAvif, or drop avif from formats.`)
    }
  } catch {}
  // A detector that throws or rejects is reported, and the image takes what no detector would.
  const fallback = (error: unknown) => {
    setTimeout(() => {
      throw error
    })
    start(pickFormat(formats as ImageFormat[]))
  }
  if (formats === 'auto') start(formats)
  // A single format needs no detector, so none that hangs can hold the image back.
  else if (!formats[1]) start(formats[0]!)
  else
    try {
      const chosen = (o.detectFormat ?? pickFormat)(formats)
      if (typeof chosen == 'string') start(chosen)
      else chosen.then(start, fallback)
    } catch (error) {
      fallback(error)
    }
  return () => unfocus()
}

/**
 * A controller instance. Creating it does nothing: observers and format
 * detection start on first need. Several instances, and several copies of
 * the package, can share one page. `createLazyEase` from
 * `@lazy-ease/core/prepared` is the same controller without measured mode.
 */
export function createLazyEase(config: LazyEaseConfig = {}): LazyEase {
  return createController(config, measure, 'src needs a loader')
}
