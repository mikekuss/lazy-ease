import { createLoader, fullLadder, Image, useLazyEaseConfig, type ImageFormat, type ImageProps } from 'lazy-ease'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { removeRecord, updateRecord } from './stats'

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
const plainLoader = createLoader()
const headSizes = new Map<string, Promise<number | undefined>>()

/** Body size of a variant from a HEAD request, once per URL. */
function contentLength(url: string): Promise<number | undefined> {
  let size = headSizes.get(url)
  if (!size) {
    size = fetch(url, { method: 'HEAD' })
      .then((response) => (response.ok ? Number(response.headers.get('content-length')) || undefined : undefined))
      .catch(() => undefined)
    headSizes.set(url, size)
  }
  return size
}

function resourceEntry(url: string): PerformanceResourceTiming | undefined {
  return performance.getEntriesByName(url, 'resource').at(-1) as PerformanceResourceTiming | undefined
}

function describe(img: HTMLImageElement): Delivered {
  const url = new URL(img.currentSrc)
  const entry = resourceEntry(img.currentSrc)
  const w = url.searchParams.get('w')
  return {
    width: w ? Number(w) : img.naturalWidth || undefined,
    format: url.searchParams.get('fmt') ?? /\.(\w+)$/.exec(url.pathname)?.[1],
    bytes: entry?.encodedBodySize || undefined,
    ms: entry ? entry.responseEnd - entry.startTime : undefined,
    // No entry at all (memory cache) or one with nothing transferred (HTTP cache).
    cached: !entry || (entry.transferSize === 0 && entry.encodedBodySize > 0),
  }
}

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
    // The box is the element carrying data-state; onLoad misses images that
    // finished before hydration, data-state does not.
    const box = figureRef.current?.querySelector<HTMLElement>('[data-state]')
    const img = box?.querySelector('img')
    if (!box || !img) return
    let naiveFor: string | undefined
    let alive = true

    const read = () => {
      const state = box.dataset.state ?? 'idle'
      const delivered = state === 'loaded' && img.currentSrc ? describe(img) : undefined
      setView((view) => ({ ...view, state, delivered }))
      updateRecord(id, { state, bytes: delivered?.bytes })

      const current = new URL(img.currentSrc || 'about:blank', location.href)
      const fmt = current.searchParams.get('fmt')
      if (!delivered || !fmt || naiveFor === img.currentSrc) return
      naiveFor = img.currentSrc
      // What the browser would pick from the full ladder for 100vw at this DPR.
      const ladder = fullLadder({ ladder: loader.widths, srcWidth })
      const target = window.innerWidth * window.devicePixelRatio
      const width = ladder.find((w) => w >= target) ?? ladder.at(-1)!
      const ar = current.searchParams.get('ar')
      const url = plainLoader.url({
        src,
        width,
        aspectRatio: ar ? Number(ar) : undefined,
        quality: Number(current.searchParams.get('q') ?? loader.qualities[0]),
        format: fmt as ImageFormat,
      })
      setView((view) => ({ ...view, naive: { width } }))
      void contentLength(url).then((bytes) => {
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
      <figcaption>
        <div className="caption-row">
          {label && <span className="label">{label}</span>}
          <span className={`state state-${state}`}>{state}</span>
          {boxWidth !== undefined && <span>box {boxWidth}px</span>}
        </div>
        {delivered && (
          <div className="caption-row">
            <span className="delivered">
              {[
                delivered.width && `${delivered.width}w`,
                delivered.format,
                delivered.bytes !== undefined && kb(delivered.bytes),
                delivered.ms !== undefined && `${delivered.ms.toFixed(0)} ms`,
                delivered.cached && 'cache',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {naive && (
              <span className="naive" title='What a sizes="100vw" srcset would have downloaded'>
                100vw: {naive.width}w{naive.bytes !== undefined && ` · ${kb(naive.bytes)}`}
              </span>
            )}
          </div>
        )}
      </figcaption>
    </figure>
  )
}
