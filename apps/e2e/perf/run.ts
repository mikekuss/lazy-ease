// Lab measurements of the demo's live build, from outside the pages: Chromium
// traces and CDP for throttling and bytes, sharp for the pixels received.
// Nothing is injected into /lcp/ in Chromium; its numbers come from the trace
// alone. Firefox and WebKit have no trace: there a PerformanceObserver is
// created after load and reads the buffered entries.
//
//   pnpm --filter demo build:live && pnpm --filter demo start   # :3001
//   pnpm --filter e2e perf [--runs 10] [--base http://localhost:3001]
//
// Writes perf-results/{time}.json and .md next to this folder (ignored by
// Git) and prints the summary. Not part of `pnpm e2e` or CI.
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test'
import sharp from 'sharp'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1]! : fallback
}
const RUNS = Number(option('runs', '10'))
const BASE = option('base', 'http://localhost:3001')
const here = path.dirname(fileURLToPath(import.meta.url))

interface Profile {
  name: string
  /** What the profile stands for, for the report. */
  label: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  isMobile: boolean
  /** CDP CPU slowdown factor. */
  cpu: number
  /** CDP network emulation, or none. */
  network?: { latency: number; downloadKbps: number; uploadKbps: number }
}

// The mobile profile follows Lighthouse's default mobile emulation (Moto G
// Power viewport, 4× CPU) with the network values Lighthouse applies when it
// throttles for real (DevTools mode: slow 4G RTT 150 ms × 3.75, throughput
// × 0.9), not the ones its simulation assumes. CDP adds the latency per request.
const MOBILE: Profile = {
  name: 'mobile',
  label: 'Lighthouse mobile, applied DevTools throttling',
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 1.75,
  isMobile: true,
  cpu: 4,
  network: { latency: 562.5, downloadKbps: 1474.56, uploadKbps: 675 },
}
const DESKTOP: Profile = { name: 'desktop', label: 'desktop, unthrottled', viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, cpu: 1 }

const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'loading', 'blink.user_timing', 'rail', 'toplevel', '__metadata']

interface TraceEvent {
  name: string
  cat: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  id?: string
  id2?: { local?: string }
  args?: { frame?: string; data?: Record<string, unknown>; name?: string }
}

interface ImageRequest {
  url: string
  /** Bytes over the wire, headers included (CDP encodedDataLength). */
  transferred: number
  fromCache: boolean
}

/** CDP request tracking: returns what lists every /_img request so far, with its transferred bytes. */
async function trackImages(session: CDPSession): Promise<() => ImageRequest[]> {
  const requests = new Map<string, ImageRequest>()
  await session.send('Network.enable')
  session.on('Network.requestWillBeSent', (event) => {
    const url = new URL(event.request.url)
    if (url.pathname.includes('/_img/')) requests.set(event.requestId, { url: url.pathname + url.search, transferred: 0, fromCache: false })
  })
  session.on('Network.requestServedFromCache', (event) => {
    const request = requests.get(event.requestId)
    if (request) request.fromCache = true
  })
  session.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId)
    if (request) request.transferred = event.encodedDataLength
  })
  return () => [...requests.values()]
}

async function throttle(session: CDPSession, profile: Profile) {
  if (profile.cpu > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
  if (profile.network) {
    const { latency, downloadKbps, uploadKbps } = profile.network
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency,
      downloadThroughput: (downloadKbps * 1024) / 8,
      uploadThroughput: (uploadKbps * 1024) / 8,
    })
  }
}

/** Pixels of every image body the page received, decoded independently of its URL. */
function decodeImages(page: Page): () => Promise<{ url: string; width: number; height: number; bytes: number }[]> {
  const pending: Promise<{ url: string; width: number; height: number; bytes: number } | undefined>[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.includes('/_img/') || response.status() !== 200) return
    pending.push(
      response
        .body()
        .then(async (body) => {
          const meta = await sharp(body).metadata()
          return { url: url.pathname + url.search, width: meta.width!, height: meta.height!, bytes: body.length }
        })
        .catch(() => undefined),
    )
  })
  return async () => (await Promise.all(pending)).filter((entry) => entry !== undefined)
}

/** The main-thread metrics of one navigation in a trace. */
function pageMetrics(events: TraceEvent[], url: string) {
  const start = events.find(
    (event) => event.name === 'navigationStart' && event.args?.data?.isLoadingMainFrame && String(event.args.data.documentLoaderURL).startsWith(url),
  )
  if (!start) throw new Error(`No navigationStart for ${url} in the trace`)
  const frame = start.args!.frame!
  const ms = (ts: number) => (ts - start.ts) / 1000
  const fcp = events.find((event) => event.name === 'firstContentfulPaint' && event.args?.frame === frame)
  const candidates = events.filter((event) => event.name === 'largestContentfulPaint::Candidate' && event.args?.frame === frame)
  const lcp = candidates.at(-1)
  // CLS: the largest session window (gaps < 1 s, windows ≤ 5 s) of shifts without recent input.
  const shifts = events
    .filter((event) => event.name === 'LayoutShift' && event.args?.data && !event.args.data.had_recent_input && event.args.frame === frame)
    .map((event) => ({ ts: event.ts, score: Number(event.args!.data!.weighted_score_delta ?? event.args!.data!.score) }))
  let cls = 0
  let window = { first: 0, last: 0, score: 0 }
  for (const shift of shifts) {
    if (window.score && shift.ts - window.last < 1e6 && shift.ts - window.first < 5e6) {
      window.last = shift.ts
      window.score += shift.score
    } else window = { first: shift.ts, last: shift.ts, score: shift.score }
    cls = Math.max(cls, window.score)
  }
  // Lab TBT: main-thread tasks over 50 ms from FCP to the end of the recording.
  const main = events.find((event) => event.name === 'thread_name' && event.pid === start.pid && event.args?.name === 'CrRendererMain')
  if (!main) throw new Error(`No CrRendererMain thread for ${url} in the trace`)
  const fcpTs = fcp?.ts ?? start.ts
  const tasks = events.filter((event) => event.name === 'RunTask' && event.ph === 'X' && event.pid === start.pid && event.tid === main.tid && event.ts >= fcpTs)
  const tbt = tasks.reduce((sum, task) => sum + Math.max(0, (task.dur ?? 0) / 1000 - 50), 0)
  const longest = tasks.reduce((max, task) => Math.max(max, (task.dur ?? 0) / 1000), 0)
  return {
    fcp: fcp && ms(fcp.ts),
    lcp: lcp && ms(lcp.ts),
    lcpType: lcp?.args?.data?.type as string | undefined,
    lcpSize: lcp?.args?.data?.size as number | undefined,
    cls,
    tbt,
    longestTask: longest,
    start,
  }
}

/** Interaction latencies (Event Timing durations, ms) of the interactions in a trace. */
function interactions(events: TraceEvent[]) {
  const byInteraction = new Map<number, number>()
  for (const event of events) {
    if (event.name !== 'EventTiming' || event.ph !== 'b') continue
    const data = event.args?.data
    const id = Number(data?.interactionId)
    if (!id) continue
    byInteraction.set(id, Math.max(byInteraction.get(id) ?? 0, Number(data!.duration)))
  }
  return [...byInteraction.values()]
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
const stats = (values: number[]) =>
  values.length ? { median: median(values), min: Math.min(...values), max: Math.max(...values), n: values.length } : { median: NaN, min: NaN, max: NaN, n: 0 }

async function newPage(browser: Browser, profile: Profile): Promise<{ context: BrowserContext; page: Page; session: CDPSession }> {
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.isMobile })
  const page = await context.newPage()
  const session = await context.newCDPSession(page)
  return { context, page, session }
}

async function traced<T>(browser: Browser, page: Page, run: () => Promise<T>): Promise<{ result: T; events: TraceEvent[] }> {
  await browser.startTracing(page, { categories: CATEGORIES })
  const result = await run()
  const trace = JSON.parse((await browser.stopTracing()).toString('utf8')) as { traceEvents: TraceEvent[] }
  return { result, events: trace.traceEvents }
}

/** One cold load of /lcp/: a new context, so the HTTP cache is empty. */
async function lcpRun(browser: Browser, profile: Profile) {
  const { context, page, session } = await newPage(browser, profile)
  await throttle(session, profile)
  const images = await trackImages(session)
  const decoded = decodeImages(page)
  const url = `${BASE}/lcp/`
  const { events } = await traced(browser, page, async () => {
    await page.goto(url, { waitUntil: 'load' })
    // Quiet time after load, so late tasks and shifts are in the recording.
    await page.waitForTimeout(3000)
  })
  const metrics = pageMetrics(events, url)
  const requests = images()
  const pixels = await decoded()
  await context.close()
  return { ...metrics, start: undefined, requests, pixels }
}

/** Keyboard steps on the demo page hero frame slider, then the breakpoint jump. */
async function interactionRun(browser: Browser, profile: Profile) {
  const { context, page, session } = await newPage(browser, profile)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await throttle(session, profile)
  const images = await trackImages(session)
  const slider = page.locator('label', { hasText: 'Viewport' }).locator('input[type=range]')
  await slider.scrollIntoViewIfNeeded()
  await slider.focus()
  const before = images().length
  const { events } = await traced(browser, page, async () => {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(150)
    }
    // Past 800 px: the frame's hero switches source and crop.
    await page.keyboard.press('End')
    await page.waitForTimeout(1500)
  })
  const latencies = interactions(events)
  const requests = images().slice(before)
  await context.close()
  return { latencies, requests }
}

/** Viewport resizes on /fade/: width changes, then height-only changes. */
async function layoutRun(browser: Browser) {
  const { context, page, session } = await newPage(browser, DESKTOP)
  await page.setViewportSize({ width: 412, height: 823 })
  await page.goto(`${BASE}/fade/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const images = await trackImages(session)
  let widthPhase = 0
  const { events } = await traced(browser, page, async () => {
    // A user-timing mark per step (this is /fade/, not the LCP page) tells reflow from the resize from later shifts.
    const resize = async (size: { width: number; height: number }) => {
      await page.evaluate(() => performance.mark('le-resize'))
      await page.setViewportSize(size)
      await page.waitForTimeout(1200)
    }
    for (const width of [800, 1350]) await resize({ width, height: 823 })
    widthPhase = images().length
    for (const height of [600, 940]) await resize({ width: 1350, height })
  })
  const marks = events.filter((event) => event.name === 'le-resize').map((event) => event.ts)
  const shiftEvents = events.filter((event) => event.name === 'LayoutShift')
  const score = (list: TraceEvent[]) => list.reduce((sum, event) => sum + Number(event.args?.data?.score ?? 0), 0)
  // Within 600 ms of a resize: the page reflowing for the new viewport.
  const late = shiftEvents.filter((event) => !marks.some((mark) => event.ts >= mark && event.ts - mark < 600_000))
  const layouts = events.filter((event) => event.name === 'Layout' && event.ph === 'X')
  const requests = images()
  await context.close()
  return {
    shifts: score(shiftEvents),
    lateShifts: score(late),
    marks: marks.length,
    layoutCount: layouts.length,
    layoutMs: layouts.reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0),
    widthRequests: requests.slice(0, widthPhase),
    heightRequests: requests.slice(widthPhase),
  }
}

/** Image bytes and variants at DPR 1 and 2 for one route and CSS viewport, unthrottled. */
async function densityRun(browser: Browser, route: string, viewport: { width: number; height: number }, dpr: number) {
  const { context, page, session } = await newPage(browser, { ...DESKTOP, viewport, deviceScaleFactor: dpr })
  const images = await trackImages(session)
  const decoded = decodeImages(page)
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  // Scroll through, so every deferred image comes into range.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  })
  await page.waitForLoadState('networkidle')
  const requests = images().filter((request) => !request.fromCache)
  const pixels = await decoded()
  await context.close()
  return {
    route,
    viewport: `${viewport.width}×${viewport.height}`,
    dpr,
    requests: requests.length,
    variants: new Set(requests.map((request) => request.url)).size,
    transferred: requests.reduce((sum, request) => sum + request.transferred, 0),
    widths: [...new Set(pixels.map((entry) => entry.width))].sort((a, b) => a - b),
  }
}

/** LCP, CLS and the LCP image in Firefox and WebKit, read from buffered entries once the page is done. */
async function otherEngine(type: typeof firefox, profile: Profile) {
  const browser = await type.launch()
  const results: { lcp?: number; cls?: number; requests: number; supported: boolean }[] = []
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor })
    const page = await context.newPage()
    let requests = 0
    page.on('request', (request) => void (new URL(request.url()).pathname.includes('/_img/') && requests++))
    await page.goto(`${BASE}/lcp/`, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    // After the fact: the observer is created once loading is over and only reads the buffer.
    const entry = await page.evaluate(
      () =>
        new Promise<{ lcp?: number; cls?: number; supported: boolean }>((resolve) => {
          const types = PerformanceObserver.supportedEntryTypes
          const supported = types.includes('largest-contentful-paint')
          let lcp: number | undefined
          // Stays undefined without layout-shift support: not measured, not 0.
          let cls: number | undefined
          if (supported) new PerformanceObserver((list) => (lcp = list.getEntries().at(-1)!.startTime)).observe({ type: 'largest-contentful-paint', buffered: true })
          if (types.includes('layout-shift')) {
            cls = 0
            new PerformanceObserver((list) => {
              for (const shift of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!shift.hadRecentInput) cls! += shift.value
            }).observe({ type: 'layout-shift', buffered: true })
          }
          setTimeout(() => resolve({ lcp, cls, supported }), 200)
        }),
    )
    results.push({ ...entry, requests })
    await context.close()
  }
  const version = browser.version()
  await browser.close()
  return { engine: type.name(), version, results }
}

const format = (value: number | undefined, digits = 0) => (value === undefined || Number.isNaN(value) ? 'n/a' : value.toFixed(digits))
/** The largest CLS of the runs, n/a where the engine reports none. */
const clsMax = (runs: { cls?: number }[]) => {
  const values = runs.flatMap((run) => (run.cls === undefined ? [] : [run.cls]))
  return values.length ? format(Math.max(...values), 4) : 'n/a'
}

async function main() {
  const health = await fetch(`${BASE}/lcp/`).catch(() => undefined)
  if (!health?.ok) throw new Error(`${BASE}/lcp/ is not reachable: run \`pnpm --filter demo build:live && pnpm --filter demo start\` first`)
  const browser = await chromium.launch()
  const environment = {
    date: new Date().toISOString(),
    playwright: (createRequire(import.meta.url)('@playwright/test/package.json') as { version: string }).version,
    chromium: browser.version(),
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: `${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads)`,
    memory: `${Math.round(os.totalmem() / 2 ** 30)} GiB`,
    base: BASE,
    runs: RUNS,
  }
  console.log(environment)

  // Warm-up: the demo server renders each variant on its first request; the
  // measured runs then see its storage warm and only the browser cold.
  for (const profile of [MOBILE, DESKTOP]) await lcpRun(browser, profile)

  const lcp: Record<string, Awaited<ReturnType<typeof lcpRun>>[]> = {}
  for (const profile of [MOBILE, DESKTOP]) {
    lcp[profile.name] = []
    for (let i = 0; i < RUNS; i++) lcp[profile.name]!.push(await lcpRun(browser, profile))
  }
  const interaction: Record<string, Awaited<ReturnType<typeof interactionRun>>[]> = {}
  for (const profile of [MOBILE, DESKTOP]) {
    interaction[profile.name] = []
    for (let i = 0; i < Math.min(RUNS, 5); i++) interaction[profile.name]!.push(await interactionRun(browser, profile))
  }
  const layout = []
  for (let i = 0; i < Math.min(RUNS, 5); i++) layout.push(await layoutRun(browser))
  const density = []
  for (const [route, viewport] of [
    ['/lcp/', MOBILE.viewport],
    ['/lcp/', DESKTOP.viewport],
    ['/fade/', MOBILE.viewport],
    ['/fade/', DESKTOP.viewport],
  ] as const) {
    for (const dpr of [1, 2]) density.push(await densityRun(browser, route, viewport, dpr))
  }
  await browser.close()
  const engines = [await otherEngine(firefox, DESKTOP), await otherEngine(webkit, DESKTOP)]

  const lines: string[] = []
  lines.push(`# Lab measurements, ${environment.date}`, '')
  lines.push(`Playwright ${environment.playwright}, Chromium ${environment.chromium}, Node ${environment.node}; ${environment.os}; ${environment.cpu}; ${environment.memory}. Server: ${BASE} (demo live build).`, '')
  lines.push('## Method', '')
  for (const profile of [MOBILE, DESKTOP]) {
    const network = profile.network
      ? `${profile.network.latency} ms request latency, ${profile.network.downloadKbps} kbps down, ${profile.network.uploadKbps} kbps up (CDP Network.emulateNetworkConditions)`
      : 'no network throttling'
    const cpu = profile.cpu > 1 ? `CPU ${profile.cpu}× slowdown (CDP Emulation.setCPUThrottlingRate)` : 'CPU unthrottled'
    lines.push(`- ${profile.name} (${profile.label}): ${profile.viewport.width}×${profile.viewport.height} CSS px, DPR ${profile.deviceScaleFactor}${profile.isMobile ? ', mobile with touch' : ''}; ${cpu}; ${network}.`)
  }
  lines.push(
    `- Cold /lcp/: ${RUNS} runs per profile, each in a new context (empty HTTP cache), traced from navigation to load + 3 s. One warm-up run per profile comes first and is not counted.`,
    '- TBT: main-thread tasks over 50 ms, summed from FCP to the end of the recording.',
    '- Interactions: 10 ArrowRight presses and one End press on the demo page viewport slider; the latency of an interaction is its longest Event Timing duration.',
    '',
  )
  lines.push('## Cold /lcp/ (Chromium trace)', '')
  lines.push('| Profile | Runs | FCP ms | LCP ms (min–max) | LCP type | CLS max | TBT ms | Longest task ms | /_img requests | Bytes | Decoded px |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const profile of [MOBILE, DESKTOP]) {
    const runs = lcp[profile.name]!
    const l = stats(runs.map((run) => run.lcp ?? NaN))
    const requests = new Set(runs.map((run) => run.requests.length))
    const bytes = stats(runs.map((run) => run.requests.reduce((sum, request) => sum + request.transferred, 0)))
    const px = [...new Set(runs.flatMap((run) => run.pixels.map((entry) => `${entry.width}×${entry.height}`)))]
    lines.push(
      `| ${profile.name} | ${runs.length} | ${format(stats(runs.map((run) => run.fcp ?? NaN)).median)} | ${format(l.median)} (${format(l.min)}–${format(l.max)}) | ${[...new Set(runs.map((run) => run.lcpType))].join(', ')} | ${format(Math.max(...runs.map((run) => run.cls)), 4)} | ${format(stats(runs.map((run) => run.tbt)).median)} (max ${format(Math.max(...runs.map((run) => run.tbt)))}) | ${format(Math.max(...runs.map((run) => run.longestTask)))} | ${[...requests].join(', ')} | ${format(bytes.median)} | ${px.join(', ')} |`,
    )
  }
  lines.push('', '## Interactions on the demo page (Event Timing in the trace)', '')
  lines.push('| Profile | Runs | Interactions per run | Latency median ms | Max ms | /_img requests per run |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const profile of [MOBILE, DESKTOP]) {
    const runs = interaction[profile.name]!
    const all = runs.flatMap((run) => run.latencies)
    lines.push(
      `| ${profile.name} | ${runs.length} | ${[...new Set(runs.map((run) => run.latencies.length))].join(', ')} | ${format(stats(all).median)} | ${format(stats(all).max)} | ${[...new Set(runs.map((run) => run.requests.length))].join(', ')} |`,
    )
  }
  lines.push('', '## Resizes on /fade/ (desktop, unthrottled)', '')
  lines.push('| Runs | Shift score, all (max) | Shift score > 600 ms after a resize (max) | Layouts | Layout ms | /_img requests on width changes | on height-only changes |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  const urls = (requests: ImageRequest[]) => requests.map((request) => request.url.replace(/^.*\/_img\//, '')).join(' ') || 'none'
  lines.push(
    `| ${layout.length} | ${format(Math.max(...layout.map((run) => run.shifts)), 4)} | ${format(Math.max(...layout.map((run) => run.lateShifts)), 4)} | ${format(stats(layout.map((run) => run.layoutCount)).median)} | ${format(stats(layout.map((run) => run.layoutMs)).median, 1)} | ${[...new Set(layout.map((run) => urls(run.widthRequests)))].join(' / ')} | ${[...new Set(layout.map((run) => urls(run.heightRequests)))].join(' / ')} |`,
  )
  lines.push('', '## 1× and 2× on the default ladder (unthrottled, scrolled through)', '')
  lines.push('| Route | CSS viewport | DPR | Requests | Variants | Bytes | Decoded widths |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const run of density) lines.push(`| ${run.route} | ${run.viewport} | ${run.dpr} | ${run.requests} | ${run.variants} | ${run.transferred} | ${run.widths.join(', ')} |`)
  lines.push('', '## Firefox and WebKit, /lcp/ desktop, unthrottled (buffered entries read after load)', '')
  lines.push('| Engine | Runs | LCP supported | LCP median ms | CLS max | /_img requests |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const { engine, version, results } of engines) {
    lines.push(
      `| ${engine} ${version} | ${results.length} | ${results[0]?.supported} | ${format(stats(results.map((run) => run.lcp ?? NaN).filter((value) => !Number.isNaN(value))).median)} | ${clsMax(results)} | ${[...new Set(results.map((run) => run.requests))].join(', ')} |`,
    )
  }
  lines.push('', '## Limitations', '')
  lines.push(
    '- Tracing has overhead of its own; the numbers compare runs of this script, not field data.',
    '- The demo server renders each variant once and keeps it: the warm-up run fills its storage, so the measured runs see a warm server and a cold browser.',
    '- Interaction latency is the Event Timing duration of single keyboard interactions, not INP over a real visit.',
    '- TBT runs from FCP to the end of the recording (load + 3 s), not to Time to Interactive as in Lighthouse.',
    '- Firefox and WebKit run unthrottled and untraced; their entries are read from the buffer after load, and CLS is n/a where layout-shift is not supported.',
  )
  const markdown = `${lines.join('\n')}\n`
  const out = path.join(here, '..', 'perf-results')
  await mkdir(out, { recursive: true })
  const stamp = environment.date.replaceAll(':', '-').replace(/\..*/, '')
  await writeFile(path.join(out, `${stamp}.json`), JSON.stringify({ environment, lcp, interaction, layout, density, engines }, null, 2))
  await writeFile(path.join(out, `${stamp}.md`), markdown)
  console.log(markdown)
}

await main()
