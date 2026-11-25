import { useEffect, useRef, useState } from 'react'
import { BASE } from '../mode'
import { pixels, stateOf, variantOf } from '../readout'

/**
 * A hero route in a frame of the given width. Its media queries see the
 * frame as the viewport, so dragging past 800px switches the source, crop
 * and focus; growing within a breakpoint selects larger candidates. The
 * readout lives here, not on the route.
 */
export const HERO_MIN_WIDTH = 280
export const HERO_MAX_WIDTH = 1440

/** 390 px, or less on a phone, so the frame fits its container at first. */
export const heroStartWidth = () => Math.max(HERO_MIN_WIDTH, Math.min(390, Math.floor((window.innerWidth - 72) / 10) * 10))

/** `run` changes the frame's URL, so a replay loads the route again. */
export function HeroFrame({ width, route, run, details }: { width: number; route: 'lcp' | 'fade'; run: number; details: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [info, setInfo] = useState('')
  // As tall as the route's hero, so the frame shows it without empty space.
  const [height, setHeight] = useState(520)

  useEffect(() => {
    const timer = setInterval(() => {
      const img = frame.current?.contentDocument?.querySelector<HTMLImageElement>('[data-hero] img')
      if (!img) return setInfo('')
      const hero = img.closest('[data-hero]')!.getBoundingClientRect()
      setHeight(Math.ceil(hero.bottom + frame.current!.contentWindow!.scrollY) + 20)
      const { aspectRatio, focalPoint } = variantOf(img.currentSrc || 'about:blank')
      const crop = aspectRatio === undefined ? '' : `ar ${aspectRatio}${focalPoint ? ` · focus ${focalPoint.x}/${focalPoint.y}` : ''}`
      void pixels(img).then((size) => setInfo([route === 'fade' && stateOf(img), crop, size].filter(Boolean).join(' · ')))
    }, 250)
    return () => clearInterval(timer)
  }, [route])

  // The route's own header and controls are not part of the hero; the frame
  // shows the hero alone. Same origin, so a style in its document does it,
  // added as soon as the route's head exists, before the header paints, not
  // on load, which waits for the images.
  useEffect(() => {
    let request = 0
    const hide = () => {
      // Every frame, cheaply: a replay or route switch brings a new document.
      const doc = frame.current?.contentDocument
      if (doc?.head && doc.location.pathname.endsWith(`/${route}/`) && !doc.getElementById('frame-chrome')) {
        const style = doc.createElement('style')
        style.id = 'frame-chrome'
        style.textContent = 'html { overflow: hidden } .site, .bar, .case > h2, .props { display: none }'
        doc.head.append(style)
      }
      request = requestAnimationFrame(hide)
    }
    request = requestAnimationFrame(hide)
    return () => cancelAnimationFrame(request)
  }, [route, run])

  return (
    <>
      <div className="hero-frame">
        <iframe ref={frame} title="Hero route" src={`${BASE}${route}/${run ? `?run=${run}` : ''}`} style={{ width, height }} />
      </div>
      {details && <span className="readout">{info}</span>}
    </>
  )
}
