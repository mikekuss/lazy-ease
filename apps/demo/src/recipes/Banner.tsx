import { imageSet, whenVisible, type ImageLoader } from '@lazy-ease/core'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BANNER } from '../catalog'
import { BANNER_WIDTH } from '../plan'
import { variantOf } from '../readout'

/**
 * Decorative background: CSS selects the image once `data-le-visible` is
 * set; the core helpers build the image-set() and watch visibility.
 */
export function Banner({ loader }: { loader: ImageLoader }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const value = useMemo(
    () => imageSet({ src: BANNER.src, width: BANNER_WIDTH, loader, aspectRatio: BANNER.aspectRatio, srcWidth: BANNER.width }),
    [loader],
  )

  useEffect(() => {
    const banner = ref.current
    if (!banner) return
    return whenVisible(banner, { rootMargin: '400px', dwellTime: 0 }, () => {
      banner.setAttribute('data-le-visible', '')
      setVisible(true)
    })
  }, [value])

  // The widths of the first format's options, e.g. "w750 1x, w1440 2x".
  const options = [...value.matchAll(/url\("([^"]+)"\)\s+([\d.]+x)(?:\s+type\("([^"]+)"\))?/g)]
  const first = options[0]?.[3]
  const summary = options
    .filter((option) => option[3] === first)
    .map((option) => `w${variantOf(option[1]!).width} ${option[2]}`)
    .join(', ')

  return (
    <figure className="demo-image banner-figure">
      <div ref={ref} key={value} data-banner aria-hidden="true" style={{ '--banner': value } as CSSProperties} />
      <figcaption>
        <div className="caption-row">
          <span className="label">image-set()</span>
          <span>{visible ? 'visible' : 'waiting'}</span>
        </div>
        <div className="caption-row delivered">{summary}</div>
      </figcaption>
    </figure>
  )
}
