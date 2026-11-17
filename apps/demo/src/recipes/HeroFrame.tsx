import { useEffect, useRef, useState } from 'react'
import { BASE } from '../mode'
import { pixels, stateOf, variantOf } from '../readout'

/**
 * A hero route in a frame of adjustable width. Its media queries see the
 * frame as the viewport, so dragging past 800px switches the source, crop
 * and focus; growing within a breakpoint selects larger candidates. The
 * readout lives here, not on the route.
 */
const MIN_WIDTH = 320
const START_WIDTH = 390

export function HeroFrame() {
  const [width, setWidth] = useState(START_WIDTH)
  const [route, setRoute] = useState<'lcp' | 'fade'>('lcp')
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [info, setInfo] = useState('')

  // On a phone the container is narrower than 390px: start at its width so
  // the frame fits. The slider still goes wider; the container scrolls then.
  useEffect(() => {
    const available = box.current?.clientWidth
    if (available && available < START_WIDTH) setWidth(Math.max(MIN_WIDTH, Math.floor(available / 10) * 10))
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const img = frame.current?.contentDocument?.querySelector<HTMLImageElement>('[data-hero] img')
      if (!img) return setInfo('')
      const { aspectRatio, focalPoint } = variantOf(img.currentSrc || 'about:blank')
      const crop = aspectRatio === undefined ? '' : `ar ${aspectRatio}${focalPoint ? ` · focus ${focalPoint.x}/${focalPoint.y}` : ''}`
      void pixels(img).then((size) => setInfo([route === 'fade' && stateOf(img), crop, size].filter(Boolean).join(' · ')))
    }, 250)
    return () => clearInterval(timer)
  }, [route])

  return (
    <>
      <div className="inline-controls">
        <label className="field range">
          <span>
            Viewport <output>{width} px</output>
          </span>
          <input type="range" min={MIN_WIDTH} max={1440} step={10} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Route</span>
          <select value={route} onChange={(e) => setRoute(e.target.value as 'lcp' | 'fade')}>
            <option value="lcp">LCP</option>
            <option value="fade">Fade</option>
          </select>
        </label>
        <span className="readout">{info}</span>
      </div>
      <div className="hero-frame" ref={box}>
        <iframe ref={frame} title="Hero route" src={`${BASE}${route}/`} style={{ width }} />
      </div>
    </>
  )
}
