import { createLoader, fullLadder, Image, useLazyEaseConfig, type ImageFormat, type ImageProps } from '@lazy-ease/react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { BASE, STATIC } from './mode'
import { createStaticLoader } from './staticLoader'
import { removeRecord, updateRecord, whenIdle } from './stats'

interface Delivered {
  width?: number
  format?: string
  bytes?: number
  ms?: number
  cached: boolean
}

interface Naive {
  width: number
  bytes?: number
}

interface View {
  state: string
  boxWidth?: number
  delivered?: Delivered
  naive?: Naive
}

interface DemoImageProps extends ImageProps {
  label?: string
  /** Wraps the image in a positioned frame with this style, for `fill`. */
  frame?: CSSProperties
}

// No demo params, so these requests are neither throttled nor cache-busted.
const plainLoader = STATIC ? createStaticLoader({ baseUrl: `${BASE}_img` }) : createLoader()
const heads = new Map<string, { size: Promise<number | undefined>; wanted: Set<() => boolean> }>()
let headQueue = Promise.resolve()

/**
 * Body size of a variant from a HEAD request, once per URL. The server renders
 * the variant to answer, so HEADs run one at a time and only while no image is
 * loading; otherwise they would skew the load times the demo shows. A HEAD that
 * no image wants any more by its turn is skipped.
 */
function contentLength(url: string, wanted: () => boolean): Promise<number | undefined> {
  let head = heads.get(url)
  if (!head) {
    const callers = new Set<() => boolean>()
    const size = headQueue.then(whenIdle).then(() => {
      if (![...callers].some((caller) => caller())) {
        heads.delete(url)
        return undefined
      }
      return fetch(url, { method: 'HEAD' })
        .then((response) => (response.ok ? Number(response.headers.get('content-length')) || undefined : undefined))
        .catch(() => undefined)
    })
    headQueue = size.then(() => undefined)
    head = { size, wanted: callers }
    heads.set(url, head)
  }
  head.wanted.add(wanted)
  return head.size
}

function resourceEntry(url: string): PerformanceResourceTiming | undefined {
  return performance.getEntriesByName(url, 'resource').at(-1) as PerformanceResourceTiming | undefined
}

interface Variant {
  width?: number
  aspectRatio?: number
  quality?: number
  format?: string
}

/**
 * Reads a variant back from its URL: the default loader's query string, or
 * the static loader's `…/w640-ar1.5-q75.webp` file name.
 */
function variantOf(src: string): Variant {
  const url = new URL(src, location.href)
  const file = /\/w(\d+)(?:-ar([\d.]+))?-q([\d.]+)\.(\w+)$/.exec(url.pathname)
  if (file) {
    const [, w, ar, q, format] = file
    return { width: Number(w), aspectRatio: ar ? Number(ar) : undefined, quality: Number(q), format }
  }
  const number = (name: string) => {
    const value = url.searchParams.get(name)
    return value ? Number(value) : undefined
  }
  return {
    width: number('w'),
    aspectRatio: number('ar'),
    quality: number('q'),
    format: url.searchParams.get('fmt') ?? undefined,
  }
}

function describe(img: HTMLImageElement): Delivered {
  const url = new URL(img.currentSrc)
  const entry = resourceEntry(img.currentSrc)
  const variant = variantOf(img.currentSrc)
  return {
    width: variant.width ?? (img.naturalWidth || undefined),
    format: variant.format ?? /\.(\w+)$/.exec(url.pathname)?.[1],
    bytes: entry?.encodedBodySize || undefined,
    ms: entry ? entry.responseEnd - entry.startTime : undefined,
    // No entry at all (memory cache) or one with nothing transferred (HTTP
    // cache). A response the static demo's service worker throttled reports
    // nothing transferred either; only those URLs carry `kbps`.
    cached: !entry || (entry.transferSize === 0 && entry.encodedBodySize > 0 && !(STATIC && url.searchParams.has('kbps'))),
  }
}

const STATES = ['idle', 'loading', 'loaded', 'error'] as const

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

/**
 * `<Image>` with a caption showing its state, the measured box, what was
 * delivered and what a plain `sizes="100vw"` srcset would have downloaded.
 */
export function DemoImage({ label, frame, ...props }: DemoImageProps) {
  const id = useId()
  const { loader } = useLazyEaseConfig()
  const figureRef = useRef<HTMLElement>(null)
  const [view, setView] = useState<View>({ state: 'idle' })
  const { src, srcWidth } = props

  useEffect(() => {
    // The marked box, or the img itself when it needs none, carries
    // data-state; onLoad misses images that finished before hydration,
    // data-state does not.
    const box = figureRef.current?.querySelector<HTMLElement>('[data-le]')
    const img = box instanceof HTMLImageElement ? box : box?.querySelector('img')
    if (!box || !img) return
    let naiveFor: string | undefined
    let alive = true

    const read = () => {
      const state = box.dataset.state ?? 'idle'
      const delivered = state === 'loaded' && img.currentSrc ? describe(img) : undefined
      setView((view) => ({ ...view, state, delivered }))
      updateRecord(id, { state, bytes: delivered?.bytes })

      const current = variantOf(img.currentSrc || 'about:blank')
      const fmt = current.format
      if (!delivered || !current.width || !fmt || naiveFor === img.currentSrc) return
      naiveFor = img.currentSrc
      // What the browser would pick from the full ladder for 100vw at this DPR.
      const ladder = fullLadder({ ladder: loader.widths, srcWidth })
      const target = window.innerWidth * window.devicePixelRatio
      const width = ladder.find((w) => w >= target) ?? ladder.at(-1)!
      const url = plainLoader.url({
        src,
        width,
        aspectRatio: current.aspectRatio,
        quality: current.quality ?? loader.qualities[0]!,
        format: fmt as ImageFormat,
      })
      setView((view) => ({ ...view, naive: { width } }))
      void contentLength(url, () => alive).then((bytes) => {
        if (!alive) return
        setView((view) => ({ ...view, naive: { width, bytes } }))
        updateRecord(id, { naiveBytes: bytes })
      })
    }

    const states = new MutationObserver(read)
    states.observe(box, { attributes: true, attributeFilter: ['data-state'] })
    // Later srcset upgrades change currentSrc without a state change.
    img.addEventListener('load', read)
    const sizes = new ResizeObserver(([entry]) => {
      const boxWidth = Math.round(entry!.contentRect.width)
      setView((view) => (view.boxWidth === boxWidth ? view : { ...view, boxWidth }))
    })
    sizes.observe(box)
    read()

    return () => {
      alive = false
      states.disconnect()
      sizes.disconnect()
      img.removeEventListener('load', read)
      removeRecord(id)
    }
  }, [id, loader, src, srcWidth])

  const { state, boxWidth, delivered, naive } = view
  const image = <Image {...props} />

  return (
    <figure className="demo-image" ref={figureRef}>
      {frame ? (
        <div className="frame" style={frame}>
          {image}
        </div>
      ) : (
        image
      )}
      {/* Three fixed one-line rows, rendered from the start, so filling them
          in after load never changes the card's height. */}
      <figcaption>
        <div className="caption-row">
          {label && <span className="label">{label}</span>}
          {/* Every state word sits in the same grid cell and only the current
              one is visible: the badge is as wide as the widest word, and a
              state change moves no text. */}
          <span className={`state state-${state}`}>
            {STATES.map((name) => (
              <span key={name} className={name === state ? undefined : 'off'} aria-hidden={name !== state}>
                {name}
              </span>
            ))}
          </span>
          <span>{boxWidth !== undefined && `box ${boxWidth}px`}</span>
        </div>
        <div className="caption-row delivered">
          {delivered &&
            [
              delivered.width && `${delivered.width}w`,
              delivered.format,
              delivered.bytes !== undefined && kb(delivered.bytes),
              delivered.ms !== undefined && `${delivered.ms.toFixed(0)} ms`,
              delivered.cached && 'cache',
            ]
              .filter(Boolean)
              .join(' · ')}
        </div>
        <div className="caption-row naive" title='What a sizes="100vw" srcset would have downloaded'>
          {naive && `100vw: ${naive.width}w${naive.bytes !== undefined ? ` · ${kb(naive.bytes)}` : ''}`}
        </div>
      </figcaption>
    </figure>
  )
}
