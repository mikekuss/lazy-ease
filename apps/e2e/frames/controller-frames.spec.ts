/**
 * Pixel frame test for the controller case page (apps/demo/controller.html).
 * Opt-in: `pnpm test:frames`. See RELEASING.md for when to run it.
 *
 * 1. Every case on the page must pass its own checks (DOM-based, including
 *    the per-frame filmstrip).
 * 2. A set of cases is run again while Chromium records real compositor
 *    frames (CDP Page.startScreencast). Each frame is cropped to the case's
 *    image box and judged by its pixels alone, without asking the DOM. A box
 *    that resizes is cropped to the part it covers in every frame; a box in
 *    a scroll root to the part visible once scrolled in (smooth scrolling is
 *    made instant while filming, so the box doesn't move under the crop).
 *
 * Why not the DOM alone: the filmstrip samples at requestAnimationFrame, before
 * ResizeObserver callbacks run in the same frame, so it can report a frame
 * the screen never showed. The pixels are what the user sees.
 *
 * How a frame is judged (all comparisons per pixel, RGB, tolerance TOL):
 *
 * - References. After the run the box is rendered again, as a clone of the
 *   box in the same place without an img: P, the box with each placeholder
 *   style it had (color or ThumbHash), and E, the bare box (its striped
 *   background), i.e. what a blank box looks like. These are clean by
 *   construction: there is no img that could draw alt text or an icon.
 * - Anchors. The first and last frame and every frame that stayed on screen
 *   for at least HOLD ms are anchors (the settled states of the run).
 * - Explained. A frame is explained when nearly every pixel lies on the RGB
 *   line segment between the same pixel of two frames around it: the anchor
 *   before it and any frame up to the next anchor, or any frame since the
 *   previous anchor and the next anchor. That covers a fade (a global blend),
 *   progressive decoding (some rows already the image, the rest still the
 *   placeholder) and plain swaps, also into an image that was replaced again
 *   before it settled.
 * - Class. Each frame is also compared with P and E: `placeholder` (matches a
 *   P), `blank` (matches E), `overlay` (differs from P or E in a small area
 *   only, i.e. something small was drawn over the placeholder or the empty
 *   box: alt text, a broken-image icon), or `image` (differs from both nearly
 *   everywhere: the image or a blend into it).
 *
 * A frame fails when it is an overlay that is not explained, or when it is
 * blank right after the placeholder and before the image (a gap between
 * placeholder and image; blank while scrolled out of a scroll root is fine).
 * An anchor is never explained by itself, so a settled frame of alt text
 * fails too, and so does a last frame that is an overlay. On failure the
 * contact sheet of all distinct frames is attached to the report, failing
 * frames framed in red (FRAMES_SHEETS=1 attaches it for passing tests too).
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import sharp, { type OverlayOptions } from 'sharp'

/** Max channel difference that still counts as the same pixel. */
const TOL = 14
/** Settled frames: on screen for at least this long. */
const HOLD = 150
/** Off pixels tolerated in a match: this share of the area, at least NOISE_MIN pixels. */
const NOISE_SHARE = 0.0004
const NOISE_MIN = 12
/** Below this share of differing pixels, a difference is local (an overlay). */
const LOCAL_SHARE = 0.2

/**
 * The cases filmed: fades, placeholders, priority adoption, resize upgrades,
 * failed upgrades, update(), and the lazy images that wait in view of a
 * scroll root, where a missing inert src shows as alt text on screen.
 */
const FILMED = [
  'measured',
  'thumbhash',
  'prepared',
  'custom-root',
  'dwell',
  'priority',
  'priority-update',
  'grow',
  'failed-upgrade',
  'update',
  'no-fade',
]

const VIEWPORT = { width: 1280, height: 900 }
/** px cut from each side of the box: its border radius. */
const INSET = 6

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface BoxState {
  css: string
  cls: string
}

interface Recording {
  frames: { data: Buffer; t: number }[]
  clickedAt: number
  crop: Rect
  placeholders: BoxState[]
  classes: string[]
}

type FrameClass = 'placeholder' | 'blank' | 'overlay' | 'image'

interface Judged {
  index: number
  at: number
  held: number
  anchor: boolean
  explained: boolean
  cls: FrameClass
  fail?: string
  png: Buffer
}

test.describe.configure({ mode: 'default' })

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await page.goto('/controller.html')
  await page.waitForFunction(() => /cases/.test(document.getElementById('summary')?.textContent ?? ''), null, { timeout: 120_000 })
  await page.waitForFunction(() => document.querySelector('#summary .pending')?.textContent === '0 running', null, { timeout: 120_000 })
})

test.afterAll(async () => {
  await page?.close()
})

test('every controller case passes', async () => {
  const cases = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.case')].map((element) => ({
      id: element.id,
      status: element.dataset.status,
      failed: [...element.querySelectorAll('.checks li.fail')].map((item) => item.textContent),
    })),
  )
  expect(cases.length).toBeGreaterThan(0)
  expect(cases.filter((c) => c.status !== 'pass')).toEqual([])
})

for (const id of FILMED) {
  test(`frames of "${id}" show no alt text, broken icon or blank box`, async ({}, testInfo) => {
    const recording = await record(page, id)
    const judged = await judge(recording)
    const failures = judged.filter((frame) => frame.fail)
    const summary = judged.map((f) => `${f.index}:${f.cls}${f.explained ? '' : '?'}${f.anchor ? '*' : ''}`).join(' ')
    if (failures.length > 0 || process.env.FRAMES_SHEETS) await attachSheet(testInfo, id, judged, recording)
    expect(judged.length, 'distinct frames recorded').toBeGreaterThan(1)
    expect(
      failures.map((f) => `frame ${f.index} at ${f.at} ms (${f.held} ms on screen): ${f.fail}`),
      `frames: ${summary}`,
    ).toEqual([])
  })
}

/** Reruns one case and records every frame until it has settled. */
async function record(page: Page, id: string): Promise<Recording> {
  await page.evaluate((id) => {
    document.getElementById(id)!.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -16)
  }, id)
  await page.waitForTimeout(300)

  const cdp = await page.context().newCDPSession(page)
  const frames: Recording['frames'] = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data: Buffer.from(data, 'base64'), t: (metadata.timestamp ?? Date.now() / 1000) * 1000 })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height })
  await page.waitForTimeout(200)

  // Watches the case's boxes: the area every one of them always covers, and every placeholder style they get.
  const clickedAt = await page.evaluate((id) => {
    const card = document.getElementById(id)!
    const stage = card.querySelector<HTMLElement>('.stage')!
    const state = {
      on: true,
      rect: undefined as undefined | { l: number; t: number; r: number; b: number },
      placeholders: [] as { css: string; cls: string }[],
      classes: [] as string[],
    }
    ;(window as unknown as { __frames: typeof state }).__frames = state
    const note = () => {
      for (const box of stage.querySelectorAll<HTMLElement>('.le-box')) {
        if (!state.classes.includes(box.className)) state.classes.push(box.className)
        if (box.style.backgroundColor || box.style.backgroundImage) {
          const entry = { css: box.style.cssText, cls: box.className }
          if (!state.placeholders.some((p) => p.css === entry.css && p.cls === entry.cls)) state.placeholders.push(entry)
        }
      }
    }
    new MutationObserver(note).observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
    // A box moving in a scroll root is cropped where it rests, so smooth
    // scrolling becomes instant while the case is filmed.
    const scrollTo = Element.prototype.scrollTo as (this: Element, ...args: unknown[]) => void
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      const [options] = args
      if (options && typeof options === 'object') return scrollTo.call(this, { ...(options as ScrollToOptions), behavior: 'instant' })
      return scrollTo.apply(this, args as [number, number])
    }
    ;(window as unknown as { __restoreScroll: () => void }).__restoreScroll = () => {
      Element.prototype.scrollTo = scrollTo as typeof Element.prototype.scrollTo
    }
    const measure = () => {
      if (!state.on) return
      for (const box of stage.querySelectorAll<HTMLElement>('.le-box')) {
        let r: { left: number; top: number; right: number; bottom: number } = box.getBoundingClientRect()
        // Inside a scroll root only the visible part counts, and only while most of it is visible.
        const root = box.closest<HTMLElement>('.scroller')
        if (root) {
          const outer = root.getBoundingClientRect()
          const left = outer.left + root.clientLeft
          const top = outer.top + root.clientTop
          const visible = {
            left: Math.max(r.left, left),
            top: Math.max(r.top, top),
            right: Math.min(r.right, left + root.clientWidth),
            bottom: Math.min(r.bottom, top + root.clientHeight),
          }
          const area = (rect: typeof visible) => Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top)
          if (area(visible) < area(r) * 0.4) continue
          r = visible
        }
        const u = state.rect
        state.rect = u
          ? { l: Math.max(u.l, r.left), t: Math.max(u.t, r.top), r: Math.min(u.r, r.right), b: Math.min(u.b, r.bottom) }
          : { l: r.left, t: r.top, r: r.right, b: r.bottom }
      }
      requestAnimationFrame(measure)
    }
    requestAnimationFrame(measure)
    const at = Date.now()
    card.querySelector<HTMLButtonElement>('.again')!.click()
    note()
    return at
  }, id)

  await page.waitForFunction((id) => document.getElementById(id)!.dataset.status !== 'pending', id, { timeout: 60_000 })
  // Let the last fade and any late swap reach the screen.
  await page.waitForTimeout(800)
  await cdp.send('Page.stopScreencast')
  await cdp.detach()

  const status = await page.evaluate((id) => document.getElementById(id)!.dataset.status, id)
  // Soft, so the pixel verdict below is reported as well.
  expect.soft(status, `case "${id}" passes its own checks while filmed`).toBe('pass')

  const watched = await page.evaluate(() => {
    const state = (window as unknown as { __frames: { on: boolean; rect: { l: number; t: number; r: number; b: number }; placeholders: BoxState[]; classes: string[] } }).__frames
    state.on = false
    ;(window as unknown as { __restoreScroll: () => void }).__restoreScroll()
    return state
  })
  // The part of the box that it covers in every frame, so a box that grows or
  // shrinks never lets the page around it into the crop. Inset by the corner
  // radius, whose anti-aliased pixels change when the box resizes.
  const left = Math.max(0, Math.ceil(watched.rect.l) + INSET)
  const top = Math.max(0, Math.ceil(watched.rect.t) + INSET)
  const crop = {
    left,
    top,
    width: Math.min(VIEWPORT.width, Math.floor(watched.rect.r) - INSET) - left,
    height: Math.min(VIEWPORT.height, Math.floor(watched.rect.b) - INSET) - top,
  }
  expect(crop.width * crop.height, 'the image box is on screen').toBeGreaterThan(1000)
  const recording: Recording = { frames, clickedAt, crop, placeholders: watched.placeholders, classes: watched.classes }
  references.set(recording, await renderReferences(page, id, recording))
  return recording
}

interface References {
  placeholders: Raw[]
  blanks: Raw[]
}

interface Raw {
  data: Buffer
  png: Buffer
  label: string
}

const references = new WeakMap<Recording, References>()

/**
 * Renders P and E: a clone of the case's box without an img, in the box's
 * place, with each recorded placeholder style (P) and with none (E).
 */
async function renderReferences(page: Page, id: string, recording: Recording): Promise<References> {
  const shoot = async (state: BoxState, blank: boolean, label: string): Promise<Raw> => {
    await page.evaluate(
      ({ id, state, blank }) => {
        const box = document.querySelector<HTMLElement>(`#${id} .stage .le-box`)!
        const clone = box.cloneNode(false) as HTMLElement
        clone.className = state.cls
        clone.style.cssText = state.css
        if (blank) {
          clone.style.removeProperty('background')
          clone.style.removeProperty('background-color')
          clone.style.removeProperty('background-image')
          clone.style.removeProperty('background-size')
        }
        clone.dataset.frameReference = ''
        box.hidden = true
        box.before(clone)
      },
      { id, state, blank },
    )
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const shot = await page.screenshot({ clip: { x: recording.crop.left, y: recording.crop.top, width: recording.crop.width, height: recording.crop.height } })
    await page.evaluate((id) => {
      document.querySelector(`#${id} [data-frame-reference]`)?.remove()
      document.querySelector<HTMLElement>(`#${id} .stage .le-box`)!.hidden = false
    }, id)
    const data = await sharp(shot).removeAlpha().raw().toBuffer()
    return { data, png: shot, label }
  }
  const placeholders: Raw[] = []
  for (const [i, state] of recording.placeholders.entries()) placeholders.push(await shoot(state, false, `P${i + 1}`))
  const blanks: Raw[] = []
  const blankStates = recording.placeholders.length > 0 ? recording.placeholders : recording.classes.map((cls) => ({ cls, css: '' }))
  for (const [i, state] of blankStates.entries()) blanks.push(await shoot(state, true, `E${i + 1}`))
  return { placeholders, blanks }
}

/** Crops every frame to the box, drops repeats and judges what is left. */
async function judge(recording: Recording): Promise<Judged[]> {
  const { crop } = recording
  const refs = references.get(recording)!
  const distinct: { data: Buffer; png: Buffer; t: number }[] = []
  for (const frame of recording.frames) {
    const meta = await sharp(frame.data).metadata()
    const scale = (meta.width ?? VIEWPORT.width) / VIEWPORT.width
    let image = sharp(frame.data).extract({
      left: Math.round(crop.left * scale),
      top: Math.round(crop.top * scale),
      width: Math.round(crop.width * scale),
      height: Math.round(crop.height * scale),
    })
    if (scale !== 1) image = image.resize(crop.width, crop.height)
    const png = await image.png().toBuffer()
    const data = await sharp(png).removeAlpha().raw().toBuffer()
    if (distinct.at(-1)?.data.equals(data)) continue
    distinct.push({ data, png, t: frame.t })
  }

  const area = crop.width * crop.height
  const noise = Math.max(NOISE_MIN, Math.round(area * NOISE_SHARE))
  const held = distinct.map((frame, i) => (i + 1 < distinct.length ? distinct[i + 1]!.t - frame.t : Infinity))
  const anchors = distinct.map((_, i) => i === 0 || i === distinct.length - 1 || held[i]! >= HOLD)

  const judged = distinct.map((frame, i): Judged => {
    let before = i - 1
    while (before >= 0 && !anchors[before]) before--
    let after = i + 1
    while (after < distinct.length && !anchors[after]) after++
    // A blend may also end in, or start from, a state that was on screen
    // too briefly to be an anchor (an image replaced right after its fade),
    // so one end is an anchor and the other any frame up to the other anchor.
    const first = Math.max(before, 0)
    const last = Math.min(after, distinct.length - 1)
    const blend = (j: number, k: number) => offSegment(frame.data, distinct[j]!.data, distinct[k]!.data) <= noise
    // The first frame is the previous run's image; the last one has nothing after it and is judged by its class alone.
    let explained = i === 0
    const final = i === distinct.length - 1
    for (let k = i + 1; !explained && !final && k <= last; k++) explained = blend(first, k)
    for (let j = i - 1; !explained && !final && j >= first; j--) explained = blend(j, last)

    const toPlaceholder = Math.min(Infinity, ...refs.placeholders.map((ref) => differing(frame.data, ref.data)))
    const toBlank = Math.min(Infinity, ...refs.blanks.map((ref) => differing(frame.data, ref.data)))
    let cls: FrameClass
    if (toPlaceholder <= noise) cls = 'placeholder'
    else if (toBlank <= noise) cls = 'blank'
    else if (Math.min(toPlaceholder, toBlank) < area * LOCAL_SHARE) cls = 'overlay'
    else cls = 'image'

    let fail: string | undefined
    if (cls === 'overlay' && !explained) {
      const near = toPlaceholder <= toBlank ? 'placeholder' : 'empty box'
      fail = `something small drawn over the ${near} (${Math.min(toPlaceholder, toBlank)} px differ): alt text or a broken-image icon`
    }
    return {
      index: i + 1,
      at: Math.round(frame.t - recording.clickedAt),
      held: Number.isFinite(held[i]) ? Math.round(held[i]!) : -1,
      anchor: anchors[i]!,
      explained,
      cls,
      fail,
      png: frame.png,
    }
  })

  // A blank box is fine before the placeholder and when the box is scrolled
  // away and back, but not as the step from the placeholder to the image.
  const settled = judged.filter((frame) => frame.cls !== 'blank')
  for (const frame of judged) {
    if (frame.cls !== 'blank' || refs.placeholders.length === 0) continue
    const previous = settled.findLast((other) => other.index < frame.index)
    const next = settled.find((other) => other.index > frame.index)
    if (previous?.cls === 'placeholder' && next?.cls !== 'placeholder') frame.fail ??= 'blank box between the placeholder and the image'
  }
  return judged
}

/** Pixels of `frame` whose max channel difference to `ref` is over TOL. */
function differing(frame: Buffer, ref: Buffer): number {
  if (frame.length !== ref.length) return frame.length / 3
  let count = 0
  for (let p = 0; p < frame.length; p += 3) {
    if (
      Math.abs(frame[p]! - ref[p]!) > TOL ||
      Math.abs(frame[p + 1]! - ref[p + 1]!) > TOL ||
      Math.abs(frame[p + 2]! - ref[p + 2]!) > TOL
    )
      count++
  }
  return count
}

/** Pixels of `frame` that are not on the RGB segment between the same pixel of `a` and `b`. */
function offSegment(frame: Buffer, a: Buffer, b: Buffer): number {
  if (frame.length !== a.length || frame.length !== b.length) return frame.length / 3
  let count = 0
  for (let p = 0; p < frame.length; p += 3) {
    const ar = a[p]!, ag = a[p + 1]!, ab = a[p + 2]!
    const dr = b[p]! - ar, dg = b[p + 1]! - ag, db = b[p + 2]! - ab
    const fr = frame[p]! - ar, fg = frame[p + 1]! - ag, fb = frame[p + 2]! - ab
    const length = dr * dr + dg * dg + db * db
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, (fr * dr + fg * dg + fb * db) / length))
    if (Math.abs(fr - t * dr) > TOL || Math.abs(fg - t * dg) > TOL || Math.abs(fb - t * db) > TOL) count++
  }
  return count
}

/** One tile per distinct frame, references first; failing frames framed in red. */
async function attachSheet(testInfo: TestInfo, id: string, judged: Judged[], recording: Recording) {
  const refs = references.get(recording)!
  const tileWidth = 200
  const tileHeight = Math.max(1, Math.round((recording.crop.height / recording.crop.width) * tileWidth))
  const labelHeight = 30
  const gap = 6
  const cols = 6
  const tiles = [
    ...[...refs.placeholders, ...refs.blanks].map((ref) => ({ png: ref.png, lines: [`${ref.label}: reference`, ref.label.startsWith('P') ? 'placeholder' : 'empty box'], fail: false })),
    ...judged.slice(0, 400).map((frame) => ({
      png: frame.png,
      lines: [
        `${frame.index}: ${frame.at} ms, ${frame.held < 0 ? 'last' : `${frame.held} ms`}`,
        `${frame.cls}${frame.explained ? '' : ', unexplained'}${frame.anchor ? ', anchor' : ''}`,
      ],
      fail: !!frame.fail,
    })),
  ]
  const rows = Math.ceil(tiles.length / cols)
  const cellWidth = tileWidth + gap
  const cellHeight = tileHeight + labelHeight + gap
  const composites: OverlayOptions[] = []
  for (const [i, tile] of tiles.entries()) {
    const x = (i % cols) * cellWidth + gap
    const y = Math.floor(i / cols) * cellHeight + gap
    const color = tile.fail ? '#dc2626' : '#111827'
    const text = tile.lines
      .map((line, n) => `<text x="2" y="${12 + n * 13}" font-family="sans-serif" font-size="11" fill="${color}">${escape(line)}</text>`)
      .join('')
    composites.push({ input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}">${text}</svg>`), left: x, top: y })
    if (tile.fail) {
      composites.push({
        input: { create: { width: tileWidth + 4, height: tileHeight + 4, channels: 4, background: '#dc2626' } },
        left: x - 2,
        top: y + labelHeight - 2,
      })
    }
    composites.push({ input: await sharp(tile.png).resize(tileWidth, tileHeight, { fit: 'fill' }).png().toBuffer(), left: x, top: y + labelHeight })
  }
  const sheet = await sharp({
    create: { width: cols * cellWidth + gap, height: rows * cellHeight + gap, channels: 3, background: '#ffffff' },
  })
    .composite(composites)
    .png()
    .toBuffer()
  const file = testInfo.outputPath(`${id}-frames.png`)
  await writeFile(file, sheet)
  await testInfo.attach(`${id}-frames.png`, { path: file, contentType: 'image/png' })
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
