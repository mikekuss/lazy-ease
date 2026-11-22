// The callback contract in React, as a table: the kind of image × what the next update does × when the old source finishes.
//
// The image is deferred (the controller loads it) or native (React renders its URLs). An update gives it a new
// `src` (a new img), a new `version` (a new attachment on the same img), a new `token`, only new callbacks (the
// attachment stays), is a transition React holds back, or hides the image behind a Suspense fallback and shows
// it again. The old source finishes loading before the update, in the commit of the update (a sibling's layout
// effect lets its decode end), or the load comes after it. Every render brings its own loader and ThumbHash decoder.
//
// Whatever the combination: a callback is called only while its render is the committed one (a render may call
// its own loader and decoder while React renders it), a source gets at most one onLoad, one `loaded` and one
// reveal (no second fade), onLoad never sees a removed img, and in the end the committed source is displayed,
// attached and reported once.
import { StrictMode, Suspense, startTransition, use, useLayoutEffect, type ReactNode, type SyntheticEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createLoader, focusReveal, type ImageRequest, type LoadState, type ThumbHashDecoder } from '@lazy-ease/core'
import * as core from '../../core/test/dom-mocks.js'
import { LazyEaseProvider } from '../src/context.js'
import { Image } from '../src/Image.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const CLAIM = Symbol.for('lazy-ease.attachment')
const webp = createLoader({ formats: ['webp'] })
const FADE = 40

const changes = ['src', 'version', 'token', 'callbacks', 'held transition', 'hidden by Suspense'] as const
/** A deferred image the controller loads, or a native one whose URLs React renders into the img. */
const kinds = ['deferred', 'native'] as const
const timings = ['before the update', 'in its commit', 'after it'] as const
type Change = (typeof changes)[number]
type Timing = (typeof timings)[number]
type Kind = (typeof kinds)[number]

interface Call {
  /** The render whose callback this is. */
  tag: string
  /** The render on screen when it was called. */
  committed: string
  hook: 'onLoad' | 'loaded' | 'reveal' | 'loader' | 'decoder' | 'lazy'
  source: string
  connected: boolean
  /** Called while React rendered the image, where a render that may never commit may call its own loader and decoder. */
  rendering: boolean
}

interface View {
  tag: string
  src: string
  version: string
  token: string
  hold?: Promise<unknown>
  /** Runs in a layout effect of this render's commit. */
  kick?: () => void
}

// Set right before the image renders and cleared right after, so a call in between is one of its render.
let rendering = false
function End() {
  rendering = false
  return null
}

function Gate({ hold }: { hold?: Promise<unknown> }) {
  if (hold) use(hold)
  return null
}

async function scenario(kind: Kind, change: Change, timing: Timing, strict: boolean) {
  vi.useRealTimers()
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = env.IS_REACT_ACT_ENVIRONMENT
  env.IS_REACT_ACT_ENVIRONMENT = false
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
  const animate = vi.fn(() => ({ cancel() {} }))
  Object.defineProperty(HTMLImageElement.prototype, 'animate', { configurable: true, value: animate })
  // The first decode waits for the test; later ones resolve.
  let finish: (() => void) | undefined
  let wait = true
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() => {
    if (!wait) return Promise.resolve()
    wait = false
    return new Promise<void>((resolve) => (finish = resolve))
  })

  // As in a browser, an img is complete only for the URLs it loaded: a new URL from React loads anew.
  const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete')!
  const loadedFor = new WeakMap<HTMLImageElement, string>()
  const urls = (element: HTMLImageElement) => `${element.getAttribute('src')} ${element.getAttribute('srcset')}`
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get(this: HTMLImageElement) {
      return loadedFor.get(this) === urls(this)
    },
    set(this: HTMLImageElement, value: boolean) {
      if (value) loadedFor.set(this, urls(this))
      else loadedFor.delete(this)
    },
  })

  const calls: Call[] = []
  let committed = ''
  const img = () => container.querySelector('img')!
  const owner = () => img().closest<HTMLElement>('[data-le]')!
  const source = (url: string) => /\/(\w)\.jpg.*token=(t\d).*v=(r\d)/.exec(url)?.slice(1).join(' ') ?? url

  /** Right before the image: its layout effect runs before the image attaches, so the attachment sees its commit. */
  function Begin({ tag }: { tag: string }) {
    rendering = true
    useLayoutEffect(() => {
      rendering = false
      committed = tag
    })
    return null
  }
  function Mark({ kick }: { kick?: () => void }) {
    useLayoutEffect(() => kick?.())
    return null
  }
  const render = ({ tag, src, version, token, hold, kick }: View): ReactNode => {
    const record = (hook: Call['hook'], url: string, connected: boolean) => calls.push({ tag, committed, hook, source: source(url), connected, rendering })
    const call = (hook: Call['hook'], element: HTMLImageElement) => record(hook, element.currentSrc, element.isConnected)
    // This render's own loader and decoder: the controller must call them only once the render is committed.
    const loader = { ...webp, url: (request: ImageRequest) => (record('loader', webp.url(request), true), webp.url(request)) }
    const thumbhash: ThumbHashDecoder = () => (
      record('decoder', 'decoder', true),
      { style: { backgroundColor: 'rgb(1, 2, 3)' }, lazy: () => (record('lazy', 'lazy', true), { backgroundImage: 'url("data:image/png;base64,AAAA")' }) }
    )
    const tree = (
      <LazyEaseProvider loader={webp} thumbhash={thumbhash}>
        <Suspense fallback={null}>
          <Begin tag={tag} />
          <Image
            src={src}
            version={version}
            token={token}
            loading={kind === 'native' ? 'native' : undefined}
            loader={loader}
            placeholder="thumbhash:AAAA"
            alt="Fern"
            width={320}
            height={240}
            fadeDuration={FADE}
            onLoad={(event: SyntheticEvent<HTMLImageElement>) => call('onLoad', event.currentTarget)}
            onStateChange={(state: LoadState, element) => state === 'loaded' && call('loaded', element)}
            reveal={(edge) => (call('reveal', img()), focusReveal(edge))}
          />
          <End />
          <Gate hold={hold} />
        </Suspense>
        <Mark kick={kick} />
      </LazyEaseProvider>
    )
    return strict ? <StrictMode>{tree}</StrictMode> : tree
  }
  /** The browser's part for the image on screen: in view, sized, and loaded unless it is displayed. */
  const browse = async (decoded = true) => {
    core.intersect(owner())
    core.resize(owner(), 320, 240)
    await tick()
    const src = img().getAttribute('src')
    // An image that is displayed has nothing left to load; a native one that React gave a new URL loads it.
    if (src === INERT || (owner().getAttribute('data-state') === 'loaded' && source(img().currentSrc) === source(src ?? ''))) return
    core.load(img())
    if (decoded) finish?.()
    await tick()
  }

  try {
    const a: View = { tag: 'A', src: '/a.jpg', version: 'r1', token: 't1' }
    root.render(render(a))
    await tick()
    if (timing === 'before the update') await browse()
    else if (timing === 'in its commit') await browse(false)

    // The old source's decode ends inside the commit, or, for an update that commits nothing, while it is held.
    const kick = timing === 'in its commit' ? () => finish?.() : undefined
    let final = a
    if (change === 'held transition') {
      startTransition(() => root.render(render({ ...a, tag: 'B', hold: new Promise(() => {}) })))
      await tick()
      kick?.()
    } else if (change === 'hidden by Suspense') {
      let show!: () => void
      root.render(render({ ...a, hold: new Promise<void>((resolve) => (show = resolve)), kick }))
      await tick()
      expect(owner().style.display).toBe('none')
      show()
      // React shows the content again only after its fallback throttle (300 ms).
      await tick(400)
      expect(owner().style.display).toBe('block')
    } else {
      final = { ...a, tag: 'B', ...(change === 'src' && { src: '/b.jpg' }), ...(change === 'version' && { version: 'r2' }), ...(change === 'token' && { token: 't2' }), kick }
      root.render(render(final))
    }
    await tick()
    await browse()
    await tick(FADE + 60)

    return {
      calls,
      final: source(img().currentSrc),
      expected: `${final.src[1]} ${final.token} ${final.version}`,
      tag: final.tag,
      state: owner().getAttribute('data-state'),
      opacity: img().style.opacity,
      claimed: (img() as unknown as Record<symbol, unknown>)[CLAIM] !== undefined,
    }
  } finally {
    root.unmount()
    container.remove()
    env.IS_REACT_ACT_ENVIRONMENT = previous
    delete (HTMLImageElement.prototype as { animate?: unknown }).animate
    Object.defineProperty(HTMLImageElement.prototype, 'complete', complete)
  }
}

describe.each(kinds)('%s image', (kind) => {
describe.each([false, true])('the next update and the old source (Strict Mode: %s)', (strict) => {
  describe.each(changes)('%s', (change) => {
    it.each(timings)('the old source finishes %s', async (timing) => {
      const { calls, final, expected, tag, state, opacity, claimed } = await scenario(kind, change, timing, strict)
      const of = (hook: Call['hook'], source: string) => calls.filter((call) => call.hook === hook && call.source === source)

      const pure = ['loader', 'decoder', 'lazy'] as const
      const isPure = (call: Call) => pure.some((hook) => hook === call.hook)
      // Only the committed render's callbacks, its loader and decoder included, and never for an img that left the
      // document. Only the loader and decoder may run while React renders, for that render.
      expect(calls.filter((call) => !(call.rendering && isPure(call)) && call.hook !== 'lazy' && call.tag !== call.committed)).toEqual([])
      expect(calls.filter((call) => !call.connected)).toEqual([])
      // A ThumbHash's lazy() belongs to the decode the attachment made, and the decoder is pure: an attachment that
      // outlives its render (an update of the callbacks alone) still swaps in that decode's image, but no other.
      let decoded: string | undefined
      for (const call of calls) {
        if (call.hook === 'decoder' && !call.rendering) decoded = call.tag
        else if (call.hook === 'lazy') expect(call.tag, 'lazy() of the last decode').toBe(decoded)
      }
      if (kind === 'native') {
        // A native image's URLs and placeholder are rendered: the controller calls neither the loader nor the decoder.
        expect(calls.filter((call) => isPure(call) && !call.rendering)).toEqual([])
      } else {
        // The controller does reach the loader and decoder; those of the committed render where it attached again.
        const attachedAgain = change === 'src' || change === 'version'
        for (const hook of ['loader', 'decoder'] as const)
          expect(calls.some((call) => call.hook === hook && !call.rendering && (!attachedAgain || call.tag === tag)), hook).toBe(true)
      }
      // Once per source at most: no second onLoad, no second fade.
      for (const source of new Set(calls.map((call) => call.source)))
        for (const hook of ['onLoad', 'loaded', 'reveal'] as const) expect(of(hook, source).length, `${hook} of ${source}`).toBeLessThanOrEqual(1)
      // A source replaced before it was displayed reaches nothing. A native image is displayed on its load, not its decode.
      const replaced = (change === 'src' || change === 'version') && timing !== 'before the update' && !(kind === 'native' && timing === 'in its commit')
      // Its loader may have built its URLs (while rendering, or for a browse before the update), but the controller
      // asks it for nothing once the update is in.
      const browsedBefore = timing === 'in its commit'
      if (replaced) expect(calls.filter((call) => call.source === 'a t1 r1' && (call.hook !== 'loader' || (!browsedBefore && !call.rendering)))).toEqual([])
      // The committed source is displayed, once.
      expect(final).toBe(expected)
      expect([state, opacity, claimed]).toEqual(['loaded', '', true])
      // A measured image's source leaves out the token: a new one after its first display upgrades it in place,
      // and the reports stay with the URL it was first displayed at.
      const upgraded = kind === 'deferred' && change === 'token' && timing !== 'after it'
      const reported = upgraded ? 'a t1 r1' : expected
      if (upgraded) expect(calls.filter((call) => call.source === expected && call.hook !== 'loader')).toEqual([])
      expect(of('onLoad', reported)).toHaveLength(1)
      expect(of('loaded', reported)).toHaveLength(1)
      // An image whose decode ends as a new attachment of the same source starts (it finished loading while it was
      // hidden, or a new token re-attaches a measured image) is adopted: the placeholder gives way to it at once,
      // without a fade. Accepted: the token is not part of the source. A native image has no fade.
      const adopted = timing === 'in its commit' && (change === 'hidden by Suspense' || (kind === 'deferred' && change === 'token'))
      expect(of('reveal', reported)).toHaveLength(kind === 'native' || adopted ? 0 : 1)
    })
  })
})
})
