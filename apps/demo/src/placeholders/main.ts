import * as thumbhash from 'thumbhash'
import { focusReveal } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'

// Compares ThumbHash placeholders as lazy-ease paints them (A raw, B blurred)
// with blurred grid SVGs, on photos, the demo scenes, hard and transparent
// synthetic cases and the viewer's own files.

interface Source {
  label: string
  url: string
  /** Large tiles with only the main variants, at the top. */
  big?: boolean
  /** Full width, before and after split by a handle. */
  hero?: boolean
}

const PHOTOS: [id: number, w: number, h: number][] = [
  [64, 800, 1000], [1027, 800, 1000], [1011, 1000, 700], [1025, 800, 800], [1062, 1000, 700], [1074, 1000, 700],
  [1084, 800, 800], [15, 1000, 700], [29, 1200, 600], [1080, 700, 1000], [0, 1000, 700], [1015, 1200, 600],
]
const SCENES = ['alpine-dawn', 'northern-night', 'ember-canyon', 'starfield']
const GRIDS = [3, 4, 5, 6, 8, 10]
const DEFAULT_GRIDS = new Set([4, 6, 8])

const picsum = (id: number, w: number, h: number) => `https://picsum.photos/id/${id}/${w}/${h}`
const hard = synthetic()

const sources: Source[] = [
  { label: 'Hero size: before | now (drag the handle)', url: picsum(1011, 1600, 900), hero: true },
  { label: 'Before / after: portrait', url: picsum(64, 800, 1000), big: true },
  { label: 'Before / after: landscape', url: picsum(1011, 1000, 700), big: true },
  { ...hard.find((source) => source.label === 'Transparent logo')!, label: 'Before / after: transparent', big: true },
  ...PHOTOS.map(([id, w, h]) => ({ label: `Photo ${id}`, url: picsum(id, w, h) })),
  ...SCENES.map((name) => ({ label: `Scene ${name}`, url: `/_img/${name}.jpg?fmt=jpeg&q=75&w=1080` })),
  ...hard,
]

// ---- Analysis -------------------------------------------------------------

interface Analysis {
  width: number
  height: number
  /** Downscaled RGBA, longer side BASE px, for the grids. */
  base: { w: number; h: number; data: Uint8ClampedArray }
  hash: Uint8Array
  /** Any pixel not fully opaque. */
  alpha: boolean
}

const BASE = 240

function draw(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}

function fit(width: number, height: number, max: number) {
  const scale = max / Math.max(width, height)
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

function analyze(img: HTMLImageElement): Analysis {
  const { naturalWidth: width, naturalHeight: height } = img
  const b = fit(width, height, BASE)
  const t = fit(width, height, 100)
  const data = draw(img, b.w, b.h)
  let alpha = false
  for (let i = 3; i < data.length && !alpha; i += 4) alpha = data[i]! < 255
  return { width, height, base: { ...b, data }, hash: thumbhash.rgbaToThumbHash(t.w, t.h, draw(img, t.w, t.h)), alpha }
}

/** Area average of each cell, alpha weighted, as [r, g, b, a] 0..255. */
function cells({ base }: Analysis, cols: number, rows: number): number[][] {
  const sums = Array.from({ length: cols * rows }, () => [0, 0, 0, 0, 0])
  for (let y = 0; y < base.h; y++) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / base.h))
    for (let x = 0; x < base.w; x++) {
      const cx = Math.min(cols - 1, Math.floor((x * cols) / base.w))
      const i = (y * base.w + x) * 4
      const a = base.data[i + 3]!
      const s = sums[cy * cols + cx]!
      s[0]! += base.data[i]! * a
      s[1]! += base.data[i + 1]! * a
      s[2]! += base.data[i + 2]! * a
      s[3]! += a
      s[4]! += 1
    }
  }
  return sums.map(([r, g, b, a, n]) => (a ? [r! / a!, g! / a!, b! / a!, a! / n!] : [0, 0, 0, 0]))
}

const hex = ([r, g, b]: number[], digits: number) =>
  digits === 3
    ? '#' + [r, g, b].map((c) => Math.round(c! / 17).toString(16)).join('')
    : '#' + [r, g, b].map((c) => Math.round(c!).toString(16).padStart(2, '0')).join('')

let blend = 'srgb'

const num = (n: number) => String(Math.round(n * 100) / 100).replace(/^0\./, '.')

// Blur, then for an opaque image alpha back to 1 so the edges stay opaque, as lazy-ease does.
const filter = (std: number, alpha: boolean) =>
  `<filter id='b'${blend === 'srgb' ? " color-interpolation-filters='sRGB'" : ''}><feGaussianBlur stdDeviation='${num(std)}'/>` +
  (alpha ? '' : `<feComponentTransfer><feFuncA type='discrete' tableValues='1 1'/></feComponentTransfer>`) +
  `</filter>`

/** Intrinsic size with the image ratio, two significant digits. */
function ratio({ width, height }: Analysis): [number, number] {
  // The shorter edge stays positive: a ratio above 200:1 would round to 0, an empty viewBox.
  const short = (edge: number) => Math.max(0.01, Number(edge.toPrecision(2)))
  return width >= height ? [100, short((100 * height) / width)] : [short((100 * width) / height), 100]
}

/**
 * Cells as 1 px strokes on a 1-unit grid over the average color, runs of one
 * color merged. Stretched to the image ratio, so the cells needn't be square.
 */
function grid(a: Analysis, long: number) {
  const cols = a.width >= a.height ? long : Math.max(1, Math.round((long * a.width) / a.height))
  const rows = a.width >= a.height ? Math.max(1, Math.round((long * a.height) / a.width)) : long
  return { cols, rows }
}

function gridSvg(a: Analysis, long: number, blur: number, digits: number) {
  const { cols, rows } = grid(a, long)
  // Each cell as its stroke attributes; with alpha also its opacity.
  const stroke = (c: number[]) => `stroke='${hex(c, digits)}'` + (a.alpha && c[3]! < 255 ? ` stroke-opacity='${num(c[3]! / 255)}'` : '')
  const colors = cells(a, cols, rows).map(stroke)
  const mean = cells(a, 1, 1)[0]!
  const average = stroke(mean)
  let paths = ''
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; ) {
      const color = colors[y * cols + x]!
      let run = 1
      while (x + run < cols && colors[y * cols + x + run] === color) run++
      if (color !== average || a.alpha) paths += `<path ${color} d='M${x} ${num(y + 0.5)}h${run}'/>`
      x += run
    }
  }
  const [w, h] = ratio(a)
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${cols} ${rows}' preserveAspectRatio='none'>` +
    filter((blur / 100) * Math.max(cols, rows), a.alpha) +
    `<g filter='url(#b)'>${a.alpha ? '' : `<rect width='${cols}' height='${rows}' fill='${hex(mean, digits)}'/>`}${paths}</g></svg>`
  return { svg, cols, rows }
}

// ---- Tiny PNG -------------------------------------------------------------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < 8 + data.length; i++) crc = CRC[(crc ^ out[i]!) & 0xff]! ^ (crc >>> 8)
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0)
  return out
}

/** An 8-bit RGB PNG of the cell colors, RGBA with `alpha`, deflated by the browser. */
async function tinyPng(colors: number[][], cols: number, rows: number, digits: number, alpha: boolean): Promise<string> {
  const q = (c: number) => (digits === 3 ? Math.round(c / 17) * 17 : Math.round(c))
  const channels = alpha ? 4 : 3
  const raw = new Uint8Array(rows * (1 + cols * channels))
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = colors[y * cols + x]!
      raw.set([q(c[0]!), q(c[1]!), q(c[2]!), q(c[3]!)].slice(0, channels), y * (1 + cols * channels) + 1 + x * channels)
    }
  }
  const zlib = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, cols)
  view.setUint32(4, rows)
  header.set([8, alpha ? 6 : 2, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())]
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    png.set(p, offset)
    offset += p.length
  }
  return `data:image/png;base64,${btoa(String.fromCharCode(...png))}`
}

/** The cell colors as a tiny PNG, stretched over the image ratio and blurred. */
async function gridPngSvg(a: Analysis, long: number, blur: number, digits: number) {
  const { cols, rows } = grid(a, long)
  const png = await tinyPng(cells(a, cols, rows), cols, rows, digits, a.alpha)
  const [w, h] = ratio(a)
  // The longer side is 100 units, so the blur is in percent of it.
  const std = blur
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>` +
    filter(std, a.alpha) + `<image width='${w}' height='${h}' preserveAspectRatio='none' filter='url(#b)' href='${png}'/></svg>`
  return { svg, cols, rows }
}

/** The decoded ThumbHash style lazy-ease paints when the image activates. */
const thumbhashStyle = (a: Analysis, blur: number) => thumbhashDecoder(thumbhash, { blur })(btoa(String.fromCharCode(...a.hash)))!.lazy!()

/** What 0.3.1 painted when the image activated: the raw ThumbHash PNG over its average color. */
function before031(a: Analysis) {
  const { r, g, b, a: alpha } = thumbhash.thumbHashToAverageRGBA(a.hash)
  const rgb = [r, g, b].map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255))
  return {
    backgroundColor: alpha >= 1 ? `rgb(${rgb.join(', ')})` : `rgba(${rgb.join(', ')}, ${+alpha.toFixed(3)})`,
    backgroundImage: cssUrl(thumbhash.thumbHashToDataURL(a.hash)),
    backgroundSize: 'cover',
  }
}

// Only `#` and `%` must be escaped; browsers take raw `<` and `>` in a data URI.
const svgUrl = (svg: string) => `data:image/svg+xml,${svg.replace(/[#%]/g, encodeURIComponent)}`
const cssUrl = (uri: string) => `url("${uri}")`

async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return (await new Response(stream).arrayBuffer()).byteLength
}

const bytes = (n: number) => (n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)} kB`)

// ---- Page -----------------------------------------------------------------

const form = document.querySelector<HTMLFormElement>('#controls')!
const rows = document.querySelector<HTMLElement>('#rows')!
const gridSet = document.querySelector<HTMLFieldSetElement>('#grids')!

for (const n of GRIDS) {
  const label = document.createElement('label')
  label.innerHTML = `<input type="checkbox" name="grid" value="${n}" ${DEFAULT_GRIDS.has(n) ? 'checked' : ''}/>${n}`
  gridSet.append(label)
}

interface Row {
  source: Source
  element: HTMLElement
  analysis?: Analysis
  img?: HTMLImageElement
}
const all: Row[] = []

function settings() {
  const data = new FormData(form)
  return {
    blur: Number(data.get('blur')),
    digits: Number(data.get('colors')),
    grids: data.getAll('grid').map(Number),
    paths: data.get('paths') === 'on',
    blend: String(data.get('blend')),
  }
}

function tile(row: Row, name: string, style: Partial<CSSStyleDeclaration>, info: string, original = false) {
  const { analysis: a, img } = row
  const figure = document.createElement('figure')
  figure.className = original ? 'tile original' : 'tile'
  // As a ThumbHash with alpha tells the controller: the placeholder stands for a transparent image.
  if (a!.alpha) figure.dataset.transparent = ''
  // A checkerboard under the frame shows what is transparent.
  const well = document.createElement('div')
  well.className = 'well'
  const frame = document.createElement('div')
  frame.className = 'frame'
  frame.style.aspectRatio = `${a!.width} / ${a!.height}`
  // The longer edge in px, so the morph starts at the placeholder's blur.
  frame.style.setProperty('--long', `calc(var(--tile, 300px) * ${Math.max(1, a!.height / a!.width)})`)
  Object.assign(frame.style, style)
  const full = document.createElement('img')
  full.src = img!.src
  full.alt = ''
  frame.append(full)
  well.append(frame)
  const caption = document.createElement('figcaption')
  caption.innerHTML = `${name}<span>${info}</span>`
  figure.append(well, caption)
  if (!original) figure.addEventListener('click', () => show(figure, !figure.classList.contains('on')))
  return figure
}

/**
 * Fades the image in or out. Like lazy-ease, the placeholder of a transparent
 * image fades out during the fade, any other stays until the fade is over.
 */
const fadeOuts = new WeakMap<HTMLElement, Animation>()

/** When the controller fades the placeholder of a transparent image out: 40–80 % of the fade, 25–60 % with a reveal. */
function fadeOutTiming(fade: number): KeyframeAnimationOptions {
  const [from, to] = document.body.dataset.morph === 'fade' ? [0.4, 0.8] : [0.25, 0.6]
  return { duration: (to - from) * fade, delay: from * fade, fill: 'forwards' }
}
const INERT = 'url("data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=")'

/** As the controller: only what the frame paints inline fades out, a CSS background stays. */
const fadeOut = (frame: HTMLElement, fade: number) =>
  frame.animate(
    { ...(frame.style.backgroundImage && { backgroundImage: INERT }), ...(frame.style.backgroundColor && { backgroundColor: 'transparent' }) },
    fadeOutTiming(fade),
  )

function show(figure: HTMLElement, on: boolean) {
  figure.classList.toggle('on', on)
  figure.classList.remove('done')
  clearTimeout(Number(figure.dataset.timer))
  fadeOuts.get(figure)?.cancel()
  if (!on) return
  const fade = parseFloat(getComputedStyle(document.body).getPropertyValue('--fade')) || 900
  const frame = figure.querySelector<HTMLElement>('.frame')!
  // As the controller: only the placeholder of a transparent image fades out.
  if ('transparent' in figure.dataset) fadeOuts.set(figure, fadeOut(frame, fade))
  figure.dataset.timer = String(setTimeout(() => figure.classList.contains('on') && figure.classList.add('done'), fade))
}

let generation = 0

/** The raw ThumbHash PNG and the blurred SVG over the full width, a handle between them. */
function hero(row: Row, blur: number) {
  const a = row.analysis!
  const split = document.createElement('div')
  split.className = 'hero'
  split.style.aspectRatio = `${a.width} / ${a.height}`
  const before = document.createElement('div')
  const after = document.createElement('div')
  Object.assign(before.style, before031(a))
  Object.assign(after.style, thumbhashStyle(a, blur))
  after.className = 'after'
  const handle = document.createElement('input')
  handle.type = 'range'
  handle.min = '0'
  handle.max = '100'
  handle.value = '50'
  handle.setAttribute('aria-label', 'Split')
  const move = () => split.style.setProperty('--split', `${handle.value}%`)
  handle.addEventListener('input', move)
  move()
  split.append(before, after, handle)
  row.element.querySelector('.tiles')!.replaceChildren(split)
}

async function render(row: Row) {
  const a = row.analysis
  if (!a) return
  if (row.source.hero) return hero(row, settings().blur)
  const run = generation
  const { blur, digits, grids, paths } = settings()
  blend = settings().blend
  const tiles: HTMLElement[] = [tile(row, 'Original', {}, `${a.width}×${a.height}`, true)]

  const hashText = `thumbhash:${btoa(String.fromCharCode(...a.hash))}`
  const raw = before031(a)
  tiles.push(tile(row, 'A · before (0.3.1): ThumbHash PNG', raw, `hash ${bytes(hashText.length)} · PNG ${bytes(raw.backgroundImage!.length)}`))

  const smooth = thumbhashStyle(a, blur)
  tiles.push(tile(row, 'B · now: ThumbHash, SVG blur', smooth, `hash ${bytes(hashText.length)} · SVG ${bytes(smooth.backgroundImage!.length)}`))

  for (const long of row.source.big ? [6] : grids) {
    const { svg, cols, rows: r } = await gridPngSvg(a, long, blur, digits)
    const uri = svgUrl(svg)
    tiles.push(
      tile(row, `C · ${cols}×${r} grid, SVG blur`, { backgroundImage: cssUrl(uri) }, `${bytes(uri.length)} · gz ${bytes(await gzipSize(uri))}`),
    )
  }
  if (paths && !row.source.big) {
    for (const long of grids) {
      const { svg, cols, rows: r } = gridSvg(a, long, blur, digits)
      const uri = svgUrl(svg)
      tiles.push(
        tile(row, `D · ${cols}×${r} grid as paths, SVG blur`, { backgroundImage: cssUrl(uri) }, `${bytes(uri.length)} · gz ${bytes(await gzipSize(uri))}`),
      )
    }
  }
  if (run !== generation) return
  // A row rebuilt while "Show images" is on starts revealed, its placeholders gone. Read once, here: the
  // toggle can change while the tiles are built.
  const on = document.body.classList.contains('reveal')
  for (const figure of tiles.slice(1)) {
    figure.classList.toggle('on', on)
    figure.classList.toggle('done', on)
  }
  row.element.querySelector('.tiles')!.replaceChildren(...tiles)
  if (row.source.big) filmstrip(row, smooth)
}

const FRAMES = 9
const STRIP = 150

/**
 * focusReveal's timing, started from the settings the tiles start from (the
 * Blur slider as `--blur`, the zoom of placeholders.css), so both agree.
 */
function reveal(edge: number, zoom: boolean): Keyframe[] {
  const [first, ...rest] = focusReveal(edge)
  const last = rest.at(-1)!
  return [
    { ...first, filter: `blur(${(edge * settings().blur) / 100}px)`, transform: zoom ? 'scale(1.06)' : 'none' },
    ...rest.slice(0, -1),
    { ...last, transform: 'none' },
  ]
}

/**
 * The reveal of B frame by frame, with the controller's animations paused at
 * fixed times: the image by the chosen morph, the placeholder of a transparent
 * image fading out in the same window as the controller. The last frame is after the release.
 */
function filmstrip(row: Row, placeholder: Record<string, string | undefined>) {
  const a = row.analysis!
  const fade = parseFloat(getComputedStyle(document.body).getPropertyValue('--fade')) || 900
  const morph = document.body.dataset.morph
  const edge = STRIP * Math.max(1, a.height / a.width)
  let strip = row.element.querySelector<HTMLElement>('.strip')
  if (!strip) {
    strip = document.createElement('div')
    strip.className = 'strip'
    row.element.append(strip)
  }
  const cells = Array.from({ length: FRAMES }, (_, i) => {
    const t = (i / (FRAMES - 1)) * fade
    const cell = document.createElement('figure')
    const well = document.createElement('div')
    well.className = 'well'
    const frame = document.createElement('div')
    frame.className = 'frame'
    frame.style.aspectRatio = `${a.width} / ${a.height}`
    const img = document.createElement('img')
    img.src = row.img!.src
    img.alt = ''
    // The page's own morph styles don't apply here, only the animations below.
    Object.assign(img.style, { opacity: '1', transition: 'none', filter: 'none', transform: 'none' })
    frame.append(img)
    well.append(frame)
    const label = document.createElement('figcaption')
    label.textContent = `${Math.round(t)} ms`
    cell.append(well, label)
    if (i < FRAMES - 1) {
      Object.assign(frame.style, placeholder)
      const keyframes = morph === 'fade' ? { opacity: [0, 1], easing: 'ease-out' } : reveal(edge, morph === 'zoom')
      const pause = (animation: Animation) => {
        animation.pause()
        animation.currentTime = t
      }
      pause(img.animate(keyframes, fade))
      if (a.alpha) pause(fadeOut(frame, fade))
    }
    return cell
  })
  strip.replaceChildren(...cells)
}

function renderAll() {
  generation++
  for (const row of all) void render(row)
}

async function add(source: Source) {
  const element = document.createElement('section')
  element.className = source.hero ? 'row wide' : source.big ? 'row big' : 'row'
  element.innerHTML = `<h2></h2><div class="tiles"></div>`
  element.querySelector('h2')!.textContent = source.label
  rows.append(element)
  const row: Row = { source, element }
  all.push(row)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = source.url
  try {
    await img.decode()
  } catch {
    element.querySelector('.tiles')!.innerHTML = `<p class="error">Could not load ${source.url}</p>`
    return
  }
  row.img = img
  row.analysis = analyze(img)
  await render(row)
}

form.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement
  if (target.name === 'tile') document.body.style.setProperty('--tile', `${target.value}px`)
  if (target.name === 'fade') document.body.style.setProperty('--fade', `${target.value}ms`)
  if (target.name === 'blur') {
    ;(form.elements.namedItem('blurOut') as HTMLOutputElement).value = `${target.value}%`
    document.body.style.setProperty('--blur', String(Number(target.value) / 100))
  }
  if (target.name === 'morph') document.body.dataset.morph = target.value
  if (['blur', 'colors', 'grid', 'paths', 'blend', 'morph', 'fade'].includes(target.name)) renderAll()
})
form.addEventListener('submit', (event) => event.preventDefault())
document.querySelector('#reveal')!.addEventListener('click', (event) => {
  const on = !document.body.classList.contains('reveal')
  document.body.classList.toggle('reveal', on)
  for (const figure of document.querySelectorAll<HTMLElement>('.tile:not(.original)')) show(figure, on)
  ;(event.target as HTMLButtonElement).textContent = on ? 'Hide images' : 'Show images'
})
document.querySelector<HTMLInputElement>('#files')!.addEventListener('change', (event) => {
  for (const file of (event.target as HTMLInputElement).files ?? []) {
    void add({ label: file.name, url: URL.createObjectURL(file) }).then(() => all.at(-1)!.element.scrollIntoView())
  }
})
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  event.preventDefault()
  for (const file of event.dataTransfer?.files ?? []) {
    if (file.type.startsWith('image/')) void add({ label: file.name, url: URL.createObjectURL(file) })
  }
})

for (const source of sources) void add(source)

// ---- Hard cases -----------------------------------------------------------

function synthetic(): Source[] {
  const make = (label: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Source => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    paint(canvas.getContext('2d')!)
    return { label, url: canvas.toDataURL('image/png') }
  }
  return [
    make('Hard edge', 900, 600, (ctx) => {
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, 900, 600)
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.moveTo(0, 600)
      ctx.lineTo(600, 0)
      ctx.lineTo(900, 0)
      ctx.lineTo(900, 600)
      ctx.fill()
    }),
    make('Bright spot', 900, 600, (ctx) => {
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, 900, 600)
      const g = ctx.createRadialGradient(650, 180, 0, 650, 180, 70)
      g.addColorStop(0, '#fff7d6')
      g.addColorStop(1, 'rgba(255,247,214,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 900, 600)
    }),
    make('Stripes', 800, 800, (ctx) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'][i % 4]!
        ctx.fillRect(i * 100, 0, 100, 800)
      }
    }),
    make('Transparent logo', 800, 500, (ctx) => {
      ctx.fillStyle = '#7c3aed'
      ctx.beginPath()
      ctx.arc(400, 250, 180, 0, Math.PI * 2)
      ctx.fill()
    }),
    make('Transparent half', 800, 600, (ctx) => {
      ctx.fillStyle = '#0ea5e9'
      ctx.fillRect(0, 0, 400, 600)
    }),
    make('Transparent soft shadow', 800, 800, (ctx) => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
      ctx.shadowBlur = 80
      ctx.shadowOffsetY = 40
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.roundRect(220, 180, 360, 360, 60)
      ctx.fill()
    }),
    make('Translucent glass', 900, 600, (ctx) => {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.35)'
      ctx.fillRect(0, 0, 900, 600)
      ctx.fillStyle = 'rgba(234, 179, 8, 0.8)'
      ctx.fillRect(500, 100, 300, 400)
    }),
  ]
}
