// @vitest-environment jsdom
// The callback contract, as a table: every callback of the page × what it does × where the image is.
//
// With `hold`, the generation under test keeps the displayed image of the one before (`keepImage`).
//
// A callback may update() the image, destroy() it, destroy it and attach it again, throw, or do one of
// the first three and then throw. The oracle is the same action taken by the page right after the step,
// outside any callback: the element and the successor's callbacks must end the same. After destroy()
// nothing writes any more. In the end no observer, timer or claim is left. An error of onStateChange,
// onDisplay, a reveal or a deferred ThumbHash decode arrives once, from a timer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLazyEase, createLoader, type AttachOptions, type Attachment, type LazyEaseConfig, type LoadState } from '../src/index.js'
import { createLazyEase as createPrepared } from '../src/prepared.js'
import { resetFormatDetection } from '../src/dom/format.js'
import { resetObservers } from '../src/dom/observe.js'
import { fail, fakeImage, installDom, intersect, load, mockAnimate, MockIntersectionObserver, MockResizeObserver, resize } from './dom-mocks.js'

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const BOX = 'display: block; background-color: rgb(1, 2, 3);'

beforeEach(() => {
  installDom()
  resetFormatDetection()
  resetObservers()
  vi.useFakeTimers()
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const hooks = ['idle', 'loading', 'loaded', 'error', 'onDisplay', 'reveal', 'decoder', 'lazy', 'loader', 'detectFormat'] as const
const actions = ['update', 'destroy', 'reattach', 'throw', 'update+throw', 'destroy+throw', 'reattach+throw'] as const
const paths = ['load', 'error', 'decode-reject'] as const
/** `native` adopts an image the element already has: its callbacks run inside update(). */
const kinds = ['measured', 'prepared', 'native'] as const
const loadings = ['lazy', 'eager'] as const
const markups = ['img', 'picture'] as const
type Hook = (typeof hooks)[number]
type Action = (typeof actions)[number] | 'none'
type Kind = (typeof kinds)[number]

/** The callbacks a kind of image calls at all. A held image has no placeholder of its own to decode. */
const applies = (kind: Kind, hook: Hook, hold: boolean) =>
  kind === 'native'
    ? ['loaded', 'error', 'onDisplay'].includes(hook)
    : (kind === 'measured' || (hook !== 'loader' && hook !== 'detectFormat')) && !(hold && (hook === 'decoder' || hook === 'lazy'))

interface Scenario {
  kind: Kind
  loading: (typeof loadings)[number]
  markup: (typeof markups)[number]
  hook: Hook
  path: (typeof paths)[number]
  /** The image before is on display, and the generation under test keeps it. */
  hold: boolean
}

interface Result {
  reached: boolean
  /** What the test's own calls and the timers threw. */
  errors: string[]
  /** The element right after the step in which the hook fired. */
  atAction?: string
  final: string
  successor: LoadState[]
  successorDisplays: number
  /** Callbacks of the generation under test after it ended. */
  late: string[]
  leaks: string
}

/**
 * Runs one scenario. The generation under test starts by update(), so its callbacks have the handle.
 * With `external`, the callback only notes that it fired and the test acts once the step is over.
 */
async function run({ kind, loading, markup, hook, path, hold }: Scenario, action: Action, external = false): Promise<Result> {
  const picture = markup === 'picture'
  const inner = `<img alt="x" src="${INERT}">`
  document.body.innerHTML = `<span data-le style="${BOX}">${picture ? `<picture><source media="(min-width:800px)" data-le-srcset="/wide.webp 1440w" data-le-sizes="50vw">${inner}</picture>` : inner}</span>`
  const box = document.querySelector('span')!
  const img = document.querySelector('img')!
  const source = document.querySelector('source')
  const fake = fakeImage(img)
  mockAnimate(img)
  mockAnimate(box)
  const out: Result = { reached: false, errors: [], final: '', successor: [], successorDisplays: 0, late: [], leaks: '' }
  let handle!: Attachment
  let acted = false
  // The image before displays (and reveals) before the generation under test starts.
  let started = false
  let ended = false
  let pending = false
  let decodes = 0
  const successorOptions: AttachOptions = {
    url: '/b.webp',
    srcset: '/b.webp 100w',
    sizes: '100px',
    onStateChange: (state) => void out.successor.push(state),
    onDisplay: () => void out.successorDisplays++,
  }
  const act = () => {
    if (action.startsWith('update')) handle.update(successorOptions)
    else if (action.startsWith('destroy')) handle.destroy()
    else if (action.startsWith('reattach')) {
      handle.destroy()
      handle = le.attach(img, successorOptions)
    }
  }
  const fire = (site: Hook) => {
    if (site !== hook || acted || !started) return
    acted = true
    out.reached = true
    if (external) return void (pending = true)
    ended = action !== 'throw' && action !== 'none'
    act()
    if (action.endsWith('throw')) throw new Error(`thrown in ${site}`)
  }
  const base = createLoader({ formats: ['webp', 'avif'], widths: [100, 200, 400] })
  const config: LazyEaseConfig = {
    loader: { ...base, url: (request) => (fire('loader'), base.url(request)) },
    detectFormat: (formats) => (fire('detectFormat'), formats[0]!),
    // The decoder runs first while update() resolves the options, where its update is overridden and its
    // error is a validation error; the hook is its second call, as the generation starts.
    thumbhash: () => (++decodes > 1 && fire('decoder'), { style: { backgroundColor: 'rgb(9, 9, 9)' }, lazy: () => (fire('lazy'), { backgroundImage: 'url("data:image/png;base64,AAAA")' }), transparent: true }),
    reveal: (edge) => (fire('reveal'), [{ opacity: 0 }, { opacity: 1, offset: edge ? 0.5 : 0.4 }]),
  }
  const le = (kind === 'measured' ? createLazyEase : createPrepared)(config)
  const callbacks: AttachOptions = {
    onStateChange: (state) => {
      if (ended && !external) out.late.push(`state ${state}`)
      fire(state)
    },
    onDisplay: () => {
      if (ended && !external) out.late.push('display')
      fire('onDisplay')
    },
  }
  const generation: AttachOptions =
    kind === 'native'
      ? { loading: 'native', ...callbacks }
      : {
          ...(kind === 'measured' ? { src: '/a.jpg', aspectRatio: 1.5 } : { url: '/a.webp', srcset: '/a.webp 100w', sizes: '100px' }),
          loading: loading === 'eager' ? 'eager' : undefined,
          placeholder: 'thumbhash:AAAA',
          keepImage: hold,
          ...callbacks,
        }
  const snapshot = () =>
    JSON.stringify([
      ...['src', 'srcset', 'sizes'].map((name) => img.getAttribute(name)),
      img.style.cssText,
      box.style.cssText,
      box.getAttribute('data-state'),
      source && ['srcset', 'sizes'].map((name) => source.getAttribute(name)),
    ])
  const caught = async (work: () => unknown) => {
    try {
      await work()
    } catch (error) {
      out.errors.push((error as Error).message)
    }
  }
  const step = async (work: () => void) => {
    const before = acted
    await caught(work)
    await caught(() => vi.advanceTimersByTimeAsync(0))
    if (pending) {
      pending = false
      ended = action !== 'none'
      act()
    }
    if (!before && acted) out.atAction = snapshot()
  }
  /** The browser's part: the image comes into view, gets a size, loads or fails, and the fade runs out. */
  const settle = async () => {
    await step(() => intersect(box))
    await step(() => resize(box, 300, 200))
    await step(() => {
      if (img.getAttribute('src') === INERT && !img.hasAttribute('srcset')) return
      if (path === 'error' && !ended) return fail(img)
      fake.decodeWith = path === 'decode-reject' && !ended ? 'reject' : 'resolve'
      load(img)
    })
    for (let i = 0; i < 12; i++) await caught(() => vi.advanceTimersByTimeAsync(100))
  }

  handle = le.attach(img, { url: '/z.webp', srcset: '/z.webp 100w', sizes: '100px', loading: 'eager', onStateChange: () => {} })
  if (hold) {
    load(img)
    await vi.advanceTimersByTimeAsync(400)
  }
  if (kind === 'native') {
    // What the element has when the native generation starts: an image that loaded, or one that failed.
    img.setAttribute('src', '/a.webp')
    img.removeAttribute('srcset')
    Object.assign(img, { complete: true, naturalWidth: path === 'error' ? 0 : 100, currentSrc: '/a.webp' })
  }
  started = true
  await step(() => handle.update(generation))
  await settle()
  // The successor, if any, gets its own events.
  if (ended) await settle()
  out.final = snapshot()
  await caught(() => handle.destroy())
  const observed = [...MockIntersectionObserver.instances, ...MockResizeObserver.instances].reduce((sum, observer) => sum + observer.elements.size, 0)
  let claim = 'free'
  try {
    createPrepared().attach(img, { loading: 'native' }).destroy()
  } catch {
    claim = 'held'
  }
  out.leaks = JSON.stringify({ observed, timers: vi.getTimerCount(), claim })
  return out
}

const CLEAN = '{"observed":0,"timers":0,"claim":"free"}'
/** A successor in the state its predecessor left reports no first `idle`. */
const states = (list: LoadState[]) => list.filter((state, i) => i || state !== 'idle').join()

/** What is wrong with one cell of the table; empty when it holds. */
async function check(scenario: Scenario, action: (typeof actions)[number]): Promise<string[] | undefined> {
  const got = await run(scenario, action)
  if (!got.reached) return
  const problems: string[] = []
  const expectEqual = (what: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${what}\n    got      ${JSON.stringify(actual)}\n    expected ${JSON.stringify(expected)}`)
  }
  const throws = action.endsWith('throw')
  const plain = (action.replace(/\+?throw$/, '') || 'none') as Action
  const error = `thrown in ${scenario.hook}`
  expectEqual('leaks', got.leaks, CLEAN)
  expectEqual('callbacks of the ended generation', got.late, [])

  // The two callbacks whose error is not the page's to recover from, when they do nothing but throw.
  if (action === 'throw' && scenario.hook === 'decoder') {
    // A decoder that throws as the generation starts is a validation error of update(): it throws,
    // and the element is released as it was before any attachment.
    // A held image stays as it is, kept for no source.
    expectEqual('errors', got.errors, [error])
    const sources = scenario.markup === 'picture' ? (scenario.hold ? ['/wide.webp 1440w', '50vw'] : [null, null]) : null
    expectEqual('element', got.final, JSON.stringify([...(scenario.hold ? ['/z.webp', '/z.webp 100w', '100px'] : [INERT, null, null]), '', BOX, null, sources]))
    return problems
  }
  if (action === 'throw' && scenario.hook === 'loader') {
    // A loader that throws has no URL: its observer subscription reports the error from a timer, and the
    // image stays on its placeholder, or a held one on display.
    expectEqual('errors', got.errors, [error])
    expectEqual('state', JSON.parse(got.final)[5], 'idle')
    expectEqual('src', JSON.parse(got.final)[0], scenario.hold ? '/z.webp' : INERT)
    return problems
  }

  // Reported once: from a timer, or for the decoder where it was called.
  expectEqual('errors', got.errors, throws ? [error] : [])
  if (plain === 'destroy') {
    expectEqual('element after destroy', got.final, got.atAction)
    if ((JSON.parse(got.final)[3] as string).includes('opacity: 0')) problems.push('left hidden')
  } else {
    const reference = await run(scenario, plain, true)
    // An update shows at once what the same update outside the callback shows, not only in the end.
    // Eager only: a lazy successor subscribed inside an intersection batch gets that batch's entry and
    // starts at once, while the oracle's waits for its own initial entry, which comes with the next step.
    if (plain === 'update' && scenario.loading === 'eager') expectEqual('element right after the update', got.atAction, reference.atAction)
    expectEqual('element', got.final, reference.final)
    expectEqual('successor states', states(got.successor), states(reference.successor))
    expectEqual('successor displays', got.successorDisplays, reference.successorDisplays)
  }
  return problems
}

for (const kind of kinds)
  for (const loading of kind === 'native' ? (['eager'] as const) : loadings)
    for (const markup of markups)
      for (const hold of kind === 'native' ? [false] : [false, true])
      describe(`${kind}, ${loading}, ${markup}${hold ? ', keepImage' : ''}`, () => {
        for (const hook of hooks) {
          if (!applies(kind, hook, hold)) continue
          it(`${hook}: update, destroy, attach again or throw`, async () => {
            const failed: string[] = []
            let reached = 0
            for (const action of actions)
              for (const path of paths) {
                if (kind === 'native' && path === 'decode-reject') continue
                const problems = await check({ kind, loading, markup, hook, path, hold }, action)
                if (!problems) continue
                reached++
                failed.push(...problems.map((problem) => `${action}, ${path}: ${problem}`))
              }
            // Every action in at least one path, or the row tests nothing.
            expect(reached).toBeGreaterThanOrEqual(actions.length)
            expect(failed).toEqual([])
          })
        }
      })
