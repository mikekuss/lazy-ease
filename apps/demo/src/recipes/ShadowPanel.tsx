import { createLazyEase, createLoader, detectAvif, type ImageLoader, type LazyEase } from '@lazy-ease/core'
import { cssText } from '@lazy-ease/vanilla/css'
import { useEffect, useRef, useState } from 'react'
import { PRIVATE } from '../catalog'
import { BASE, STATIC, fadeDuration } from '../mode'
import { SHADOW_WIDTHS } from '../plan'
import { INERT } from '../prerender'
import { pixels } from '../readout'
import { createStaticLoader } from '../staticLoader'

/**
 * The widget's own loader, as in docs/image-recipes.md: a 128px square needs
 * 128 and 256 at DPR 1 and 2, one ratio, one quality, WebP only. The static
 * build renders the private square with these widths (src/plan.ts), so every
 * URL this produces is a file there. `params` are the page's throttle
 * settings.
 */
export function shadowLoader(params: Record<string, string | number>): ImageLoader {
  const restriction = { widths: SHADOW_WIDTHS, ratios: [1] }
  return STATIC
    ? createStaticLoader({ baseUrl: `${BASE}_img`, ...restriction, formats: ['webp'], params })
    : createLoader({ baseUrl: '/_img', ...restriction, qualities: [75], formats: ['webp'], params })
}

interface Grant {
  token: string
  version: string
}

const PANEL_CSS = `
  .panel { height: 220px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #fff; font: 13px/1.5 system-ui, sans-serif; color: #4b5563 }
  .spacer { height: 360px }
  [data-le] { width: 128px; height: 128px; border-radius: 8px; background-color: #3b4a3f }
  small { display: block; margin-top: 6px; font: 11px/1.4 ui-monospace, monospace }
`

/**
 * A widget with its own shadow tree: its CSS, its own loader and controller
 * whose intersection root is the scrolling panel; the attachment is destroyed
 * on unmount. Live, the
 * image is private: the server checks the viewer on every request and the
 * crop needs the token it hands out after that check.
 */
export function ShadowPanel({ loader }: { loader: ImageLoader }) {
  const host = useRef<HTMLDivElement>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [grant, setGrant] = useState<Grant | undefined>()
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (STATIC) return
    void fetch('/api/session')
      .then((response) => response.json() as Promise<{ signedIn: boolean }>)
      .then(({ signedIn }) => setSignedIn(signedIn))
  }, [])

  useEffect(() => {
    if (STATIC || !signedIn) return setGrant(undefined)
    let alive = true
    void fetch('/api/private')
      .then((response) => (response.ok ? (response.json() as Promise<Grant>) : undefined))
      .then((next) => alive && setGrant(next))
    return () => {
      alive = false
    }
  }, [signedIn])

  // One controller per mounted panel and loader; its intersection root is
  // the panel. A grant change only replaces the attachment.
  const [controller, setController] = useState<{ le: LazyEase; panel: HTMLElement } | undefined>()
  const show = useRef<(state: string) => void>(() => {})

  useEffect(() => {
    const element = host.current
    if (!element) return
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(cssText + PANEL_CSS)
    shadow.adoptedStyleSheets = [sheet]
    shadow.innerHTML = `<div class="panel"><p>Scroll this panel.</p><div class="spacer"></div><span data-le></span><small></small></div>`
    const panel = shadow.querySelector<HTMLElement>('.panel')!
    setController({ le: createLazyEase({ loader, root: panel, detectFormat: detectAvif, fadeDuration: fadeDuration(), onStateChange: (next) => show.current(next) }), panel })
  }, [loader])

  useEffect(() => {
    if (!controller) return
    const { le, panel } = controller
    // A fresh img per grant, so the readout starts from idle again.
    const box = panel.querySelector('[data-le]')!
    box.innerHTML = `<img alt="Fern" width="${PRIVATE.size}" height="${PRIVATE.size}" src="${INERT}">`
    const img = box.querySelector('img')!
    const readout = panel.querySelector('small')!
    show.current = (next) => {
      setState(next)
      void pixels(img).then((size) => (readout.textContent = [next, size].filter(Boolean).join(' · ')))
    }
    const handle = le.attach(img, {
      src: PRIVATE.src,
      width: PRIVATE.size,
      height: PRIVATE.size,
      srcWidth: PRIVATE.width,
      srcHeight: PRIVATE.height,
      token: grant?.token,
      version: grant?.version,
    })
    show.current('idle')
    return () => {
      show.current = () => {}
      handle.destroy()
    }
  }, [controller, grant])

  const session = (method: 'POST' | 'DELETE') =>
    fetch('/api/session', { method })
      .then((response) => response.json() as Promise<{ signedIn: boolean }>)
      .then(({ signedIn }) => setSignedIn(signedIn))

  return (
    <div className="shadow-case">
      <div ref={host} />
      <div className="shadow-side">
        {STATIC ? (
          <p className="hint">Static host: public copy. Sign-in runs on the live server.</p>
        ) : (
          <>
            <p className="hint">{signedIn ? (grant ? 'Signed in, token issued' : 'Signed in') : 'Signed out'}</p>
            <button type="button" onClick={() => void session(signedIn ? 'DELETE' : 'POST')}>
              {signedIn ? 'Sign out' : 'Sign in'}
            </button>
            {state === 'error' && <p className="hint error">Denied by the server (403)</p>}
          </>
        )}
      </div>
    </div>
  )
}
