import {
  createLazyEase,
  createLoader,
  type AttachOptions,
  type Attachment,
  type LazyEaseConfig,
  type LoadState,
  type ResolvedLoader,
} from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import * as thumbhash from 'thumbhash'

/** One entry of /api/images. */
export interface SourceImage {
  src: string
  file: string
  width: number
  height: number
  thumbhash: string
  color: string
}

export type CheckStatus = 'pending' | 'pass' | 'fail'

export interface Check {
  label: string
  status: CheckStatus
  detail?: string
}

/** What a case gets to build its markup, attach images and check the result. */
export interface CaseContext {
  /** The case's live area. Emptied before every run. */
  stage: HTMLElement
  images: readonly SourceImage[]
  /** A loader whose URLs are new for every run, so the browser cache starts cold. */
  loader(options?: Parameters<typeof createLoader>[0]): ResolvedLoader
  /** A controller with the ThumbHash decoder and the case's logging. Eager unless it has a `root`. */
  lazyEase(config?: LazyEaseConfig): { attach(img: HTMLImageElement, options?: AttachOptions): Recorded }
  /** A `<div data-le>` box with an img inside, appended to `parent`. */
  box(parent: HTMLElement, className?: string, alt?: string): { box: HTMLElement; img: HTMLImageElement }
  log(message: string): void
  /** A readout line under the stage that `set` updates. */
  readout(label: string): (value: string) => void
  /** Passes once `test` returns true, fails after `timeout` ms. */
  expect(label: string, test: () => boolean, timeout?: number): Promise<boolean>
  /** Passes if `test` stays false for `duration` ms. */
  never(label: string, test: () => boolean, duration: number): Promise<boolean>
  /** Records a result at once. */
  assert(label: string, ok: boolean, detail?: string): boolean
  wait(ms: number): Promise<void>
  /** False once the case was run again or the page moved on. */
  readonly alive: boolean
}

/** An attachment plus everything it reported. */
export interface Recorded extends Attachment {
  states: LoadState[]
  displays: { event: boolean; src: string }[]
  img: HTMLImageElement
}

export interface Case {
  id: string
  group: string
  title: string
  /** What the case shows, in one or two sentences. */
  about: string
  /** The case shows a failed image on purpose, so alt text and broken icons are expected frames. */
  showsError?: boolean
  run(ctx: CaseContext): Promise<void> | void
}

/**
 * What an image area shows in one frame:
 * - placeholder: the inert source or a hidden img, so the box's placeholder;
 * - loading: the img is visible while a source is still loading, so a
 *   partial image or the previous one;
 * - fading: a complete image on its way in;
 * - image: the complete image;
 * - broken: alt text or the broken-image icon.
 */
export type FrameKind = 'placeholder' | 'loading' | 'fading' | 'image' | 'broken'

/** Consecutive frames of one kind. */
export interface FrameRun {
  kind: FrameKind
  frames: number
  /** ms since the run started. */
  at: number
}

export function frameKind(img: HTMLImageElement): FrameKind {
  const style = getComputedStyle(img)
  const opacity = Number(style.opacity)
  if (style.display === 'none' || style.visibility === 'hidden' || opacity < 0.02) return 'placeholder'
  // While a new candidate loads, Chromium reports an empty currentSrc but keeps
  // painting the previous image, so an incomplete img counts as loading.
  if (!img.complete) return 'loading'
  const src = img.currentSrc || img.getAttribute('src') || ''
  if (src.startsWith('data:image/gif')) return 'placeholder'
  if (!src || img.naturalWidth === 0) return 'broken'
  return opacity < 0.98 ? 'fading' : 'image'
}

export interface Run {
  checks: Check[]
  logs: string[]
  stop(): void
}

const POLL = 40

/** A transparent 1×1 GIF, as a template renders it into a deferred img. */
export const INERT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

let runCounter = 0
const PAGE = Date.now().toString(36)

/**
 * Runs one case in `stage`. `onChange` fires whenever a check or log line
 * is added or settles, so the card can redraw.
 */
export function runCase(
  definition: Case,
  stage: HTMLElement,
  readouts: HTMLElement,
  images: readonly SourceImage[],
  throttle: string,
  onChange: () => void,
): Run {
  // Unique across page loads too, so no run is served from the HTTP cache.
  const run = `${PAGE}-${++runCounter}`
  const started = performance.now()
  const checks: Check[] = []
  const logs: string[] = []
  const attachments: Recorded[] = []
  const filmstrips: { label: string; runs: FrameRun[] }[] = []
  let alive = true
  stage.replaceChildren()
  readouts.replaceChildren()

  const stamp = () => `${String(Math.round(performance.now() - started)).padStart(5)} ms`
  const log = (message: string) => {
    if (!alive) return
    logs.push(`${stamp()}  ${message}`)
    onChange()
  }
  const add = (label: string): Check => {
    const check: Check = { label, status: 'pending' }
    checks.push(check)
    onChange()
    return check
  }
  const settle = (check: Check, ok: boolean, detail?: string) => {
    if (!alive) return ok
    check.status = ok ? 'pass' : 'fail'
    check.detail = detail
    onChange()
    return ok
  }
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  /** Samples `img` on every animation frame and draws the runs as a filmstrip. */
  const film = (img: HTMLImageElement) => {
    const label = `img ${filmstrips.length + 1}${img.alt && img.alt !== 'Demo image' ? ` (${img.alt})` : ''}`
    const runs: FrameRun[] = []
    filmstrips.push({ label, runs })
    const line = document.createElement('div')
    line.className = 'filmstrip'
    const name = document.createElement('span')
    name.textContent = label
    const bar = document.createElement('div')
    bar.className = 'bar'
    line.append(name, bar)
    readouts.append(line)
    let drawn = 0
    const draw = () => {
      drawn = performance.now()
      bar.replaceChildren(
        ...runs.map((run) => {
          const cell = document.createElement('span')
          cell.className = `f-${run.kind}`
          cell.style.flexGrow = String(run.frames)
          cell.title = `${run.kind}: ${run.frames} frame${run.frames === 1 ? '' : 's'} from ${Math.round(run.at)} ms`
          return cell
        }),
      )
    }
    const tick = () => {
      // About a minute at 60 fps is plenty for one case.
      if (!alive || runs.reduce((sum, run) => sum + run.frames, 0) > 4000) return draw()
      const kind = frameKind(img)
      const last = runs.at(-1)
      if (last?.kind === kind) last.frames++
      else {
        runs.push({ kind, frames: 1, at: performance.now() - started })
        if (kind === 'broken') log(`frame shows alt text or a broken icon (${label})`)
      }
      if (last?.kind !== kind || performance.now() - drawn > 250) draw()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  const decoder = thumbhashDecoder(thumbhash)

  const ctx: CaseContext = {
    stage,
    images,
    get alive() {
      return alive
    },
    loader(options = {}) {
      const params = { ...(throttle === 'off' ? {} : { throttle }), run, ...options.params }
      return createLoader({ ...options, params })
    },
    lazyEase(config = {}) {
      const le = createLazyEase({ thumbhash: decoder, ...config })
      // Cases below the fold must not wait for scrolling; the scroll-root cases stay lazy.
      const loading = config.root ? undefined : ('eager' as const)
      return {
        attach(img, options = {}) {
          // A replaced run must not take over images the new run owns.
          if (!alive) throw new Error('This run was replaced')
          const states: LoadState[] = []
          const displays: Recorded['displays'] = []
          // Every generation gets the logging hooks, the first and each update().
          const hooked = (next: AttachOptions): AttachOptions => ({
            loading: next.priority || next.loading ? next.loading : loading,
            ...next,
            onStateChange(state, element) {
              states.push(state)
              log(`state → ${state}`)
              next.onStateChange?.(state, element)
            },
            onDisplay(element, event) {
              displays.push({ event: event !== undefined, src: element.currentSrc })
              log(`onDisplay${event ? ' (load event)' : ' (adopted, no event)'}: ${shortUrl(element.currentSrc)}`)
              next.onDisplay?.(element, event)
            },
          })
          const attachment = le.attach(img, hooked(options))
          const recorded: Recorded = {
            states,
            displays,
            img,
            get state() {
              return attachment.state
            },
            update: (next) => attachment.update(hooked(next)),
            destroy: () => attachment.destroy(),
          }
          attachments.push(recorded)
          return recorded
        },
      }
    },
    box(parent, className = 'frame', alt = 'Demo image') {
      const box = document.createElement('div')
      box.setAttribute('data-le', '')
      box.className = `le-box ${className}`
      const img = document.createElement('img')
      img.alt = alt
      // The markup contract: a deferred image starts with an inert inline source,
      // so the browser draws nothing (no alt text, no broken icon) until the target is assigned.
      img.src = INERT
      box.append(img)
      parent.append(box)
      film(img)
      return { box, img }
    },
    log,
    readout(label) {
      if (!alive) return () => {}
      const line = document.createElement('div')
      const name = document.createElement('span')
      name.textContent = label
      const value = document.createElement('code')
      line.append(name, value)
      readouts.append(line)
      return (text) => {
        value.textContent = text
      }
    },
    async expect(label, test, timeout = 12000) {
      const check = add(label)
      const deadline = performance.now() + timeout
      while (alive) {
        let ok = false
        try {
          ok = test()
        } catch {
          ok = false
        }
        if (ok) return settle(check, true, stamp())
        if (performance.now() > deadline) return settle(check, false, `not within ${timeout} ms`)
        await wait(POLL)
      }
      return false
    },
    async never(label, test, duration) {
      const check = add(label)
      const deadline = performance.now() + duration
      while (alive && performance.now() < deadline) {
        if (test()) return settle(check, false, `happened at ${stamp()}`)
        await wait(POLL)
      }
      return settle(check, true)
    },
    assert(label, ok, detail) {
      return settle(add(label), ok, detail)
    },
    wait,
  }

  void (async () => {
    try {
      await definition.run(ctx)
      // A frame or two after the last check, then judge every frame of the run.
      await wait(100)
      if (!definition.showsError) {
        const broken = filmstrips.flatMap(({ label, runs }) =>
          runs.filter((run) => run.kind === 'broken').map((run) => `${label}: ${run.frames} frame(s) at ${Math.round(run.at)} ms`),
        )
        ctx.assert('No frame showed alt text or a broken icon', broken.length === 0, broken.join('; ') || undefined)
      }
    } catch (error) {
      if (alive) settle(add('Case ran without throwing'), false, String(error))
    }
  })()

  return {
    checks,
    logs,
    stop() {
      alive = false
      for (const attachment of attachments) attachment.destroy()
    },
  }
}

/** The path and the width and format parameters, enough to tell candidates apart. */
export function shortUrl(url: string): string {
  if (!url) return '(none)'
  if (url.startsWith('data:')) return `${url.slice(0, 24)}…`
  try {
    const parsed = new URL(url, location.href)
    const keep = ['w', 'ar', 'fmt', 'fx', 'fy'].flatMap((key) => {
      const value = parsed.searchParams.get(key)
      return value === null ? [] : `${key}=${value}`
    })
    const origin = parsed.origin === location.origin ? '' : parsed.host
    return `${origin}${parsed.pathname}${keep.length ? `?${keep.join('&')}` : ''}`
  } catch {
    return url
  }
}

/** The `w` parameter of the image the browser shows. */
export function shownWidth(img: HTMLImageElement): number | undefined {
  const value = new URL(img.currentSrc || 'about:blank', location.href).searchParams.get('w')
  return value === null ? undefined : Number(value)
}

/** Calls `callback` for every inline style change of `element` until stopped. */
export function watchStyle(element: HTMLElement, callback: (style: CSSStyleDeclaration) => void): () => void {
  const observer = new MutationObserver(() => callback(element.style))
  observer.observe(element, { attributes: true, attributeFilter: ['style'] })
  callback(element.style)
  return () => observer.disconnect()
}
