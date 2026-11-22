// The callback contract in React, as a table: what the next update does × when the old source finishes.
//
// An update gives the image a new `src` (a new img), a new `version` (a new attachment on the same img),
// only new callbacks (the attachment stays), is a transition React holds back, or hides the image behind
// a Suspense fallback and shows it again. The old source finishes loading before the update, in the
// commit of the update (a sibling's layout effect lets its decode end), or the load comes after it.
//
// Whatever the combination: a callback is called only while its render is the committed one, a source
// gets at most one onLoad, one `loaded` and one reveal (no second fade), onLoad never sees a removed img, and in the
// end the committed source is displayed, attached and reported once.
import { StrictMode, Suspense, startTransition, use, useLayoutEffect, type ReactNode, type SyntheticEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createLoader, focusReveal, type LoadState } from '@lazy-ease/core'
import * as core from '../../core/test/dom-mocks.js'
import { LazyEaseProvider } from '../src/context.js'
import { Image } from '../src/Image.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const CLAIM = Symbol.for('lazy-ease.attachment')
const webp = createLoader({ formats: ['webp'] })
const FADE = 40

const changes = ['src', 'version', 'callbacks', 'held transition', 'hidden by Suspense'] as const
const timings = ['before the update', 'in its commit', 'after it'] as const
type Change = (typeof changes)[number]
type Timing = (typeof timings)[number]

interface Call {
  /** The render whose callback this is. */
  tag: string
  /** The render on screen when it was called. */
  committed: string
  hook: 'onLoad' | 'loaded' | 'reveal'
  source: string
  connected: boolean
}

interface View {
  tag: string
  src: string
  version: string
  hold?: Promise<unknown>
  /** Runs in a layout effect of this render's commit. */
  kick?: () => void
}

function Gate({ hold }: { hold?: Promise<unknown> }) {
  if (hold) use(hold)
  return null
}

async function scenario(change: Change, timing: Timing, strict: boolean) {
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

  const calls: Call[] = []
  let committed = ''
  const img = () => container.querySelector('img')!
  const owner = () => img().closest<HTMLElement>('[data-le]')!
  const source = (url: string) => /\/(\w)\.jpg.*v=(r\d)/.exec(url)?.slice(1).join(' ') ?? url

  function Mark({ tag, kick }: { tag: string; kick?: () => void }) {
    useLayoutEffect(() => {
      committed = tag
      kick?.()
    })
    return null
  }
  const render = ({ tag, src, version, hold, kick }: View): ReactNode => {
    const call = (hook: Call['hook'], element: HTMLImageElement) =>
      calls.push({ tag, committed, hook, source: source(element.currentSrc), connected: element.isConnected })
    const tree = (
      <LazyEaseProvider loader={webp}>
        <Suspense fallback={null}>
          <Image
            src={src}
            version={version}
            alt="Fern"
            width={320}
            height={240}
            fadeDuration={FADE}
            onLoad={(event: SyntheticEvent<HTMLImageElement>) => call('onLoad', event.currentTarget)}
            onStateChange={(state: LoadState, element) => state === 'loaded' && call('loaded', element)}
            reveal={(edge) => (call('reveal', img()), focusReveal(edge))}
          />
          <Gate hold={hold} />
        </Suspense>
        <Mark tag={tag} kick={kick} />
      </LazyEaseProvider>
    )
    return strict ? <StrictMode>{tree}</StrictMode> : tree
  }
  /** The browser's part for the image on screen: in view, sized, and loaded unless it is displayed. */
  const browse = async (decoded = true) => {
    core.intersect(owner())
    core.resize(owner(), 320, 240)
    await tick()
    if (img().getAttribute('src') === INERT || owner().getAttribute('data-state') === 'loaded') return
    core.load(img())
    if (decoded) finish?.()
    await tick()
  }

  try {
    const a: View = { tag: 'A', src: '/a.jpg', version: 'r1' }
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
      final = { ...a, tag: 'B', ...(change === 'src' && { src: '/b.jpg' }), ...(change === 'version' && { version: 'r2' }), kick }
      root.render(render(final))
    }
    await tick()
    await browse()
    await tick(FADE + 60)

    return {
      calls,
      final: source(img().currentSrc),
      expected: `${final.src[1]} ${final.version}`,
      state: owner().getAttribute('data-state'),
      opacity: img().style.opacity,
      claimed: (img() as unknown as Record<symbol, unknown>)[CLAIM] !== undefined,
    }
  } finally {
    root.unmount()
    container.remove()
    env.IS_REACT_ACT_ENVIRONMENT = previous
    delete (HTMLImageElement.prototype as { animate?: unknown }).animate
  }
}

describe.each([false, true])('the next update and the old source (Strict Mode: %s)', (strict) => {
  describe.each(changes)('%s', (change) => {
    it.each(timings)('the old source finishes %s', async (timing) => {
      const { calls, final, expected, state, opacity, claimed } = await scenario(change, timing, strict)
      const of = (hook: Call['hook'], source: string) => calls.filter((call) => call.hook === hook && call.source === source)

      // Only the committed render's callbacks, and never for an img that left the document.
      expect(calls.filter((call) => call.tag !== call.committed)).toEqual([])
      expect(calls.filter((call) => !call.connected)).toEqual([])
      // Once per source at most: no second onLoad, no second fade.
      for (const source of new Set(calls.map((call) => call.source)))
        for (const hook of ['onLoad', 'loaded', 'reveal'] as const) expect(of(hook, source).length, `${hook} of ${source}`).toBeLessThanOrEqual(1)
      // A source replaced before it was displayed reaches nothing.
      const replaced = (change === 'src' || change === 'version') && timing !== 'before the update'
      if (replaced) expect(calls.filter((call) => call.source === 'a r1')).toEqual([])
      // The committed source is displayed, once.
      expect(final).toBe(expected)
      expect([state, opacity, claimed]).toEqual(['loaded', '', true])
      expect(of('onLoad', expected)).toHaveLength(1)
      expect(of('loaded', expected)).toHaveLength(1)
      // An image that finished loading while it was hidden is adopted when it shows: displayed without a fade.
      expect(of('reveal', expected)).toHaveLength(change === 'hidden by Suspense' && timing === 'in its commit' ? 0 : 1)
    })
  })
})
