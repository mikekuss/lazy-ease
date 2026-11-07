import { CASES } from './cases'
import { runCase, type Case, type Run, type SourceImage } from './harness'
import './controller.css'

interface Card {
  definition: Case
  element: HTMLElement
  stage: HTMLElement
  readouts: HTMLElement
  checks: HTMLOListElement
  log: HTMLPreElement
  status: HTMLElement
  run?: Run
}

const casesElement = document.getElementById('cases')!
const summary = document.getElementById('summary')!
const toc = document.getElementById('toc')!
const throttleSelect = document.getElementById('throttle') as HTMLSelectElement
const cards: Card[] = []
let images: SourceImage[] = []

const ICON = { pending: '…', pass: '✓', fail: '✗' } as const

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function statusOf(run: Run | undefined): 'pending' | 'pass' | 'fail' {
  if (!run || run.checks.length === 0) return 'pending'
  if (run.checks.some((check) => check.status === 'fail')) return 'fail'
  return run.checks.some((check) => check.status === 'pending') ? 'pending' : 'pass'
}

function render(card: Card) {
  const run = card.run
  const status = statusOf(run)
  card.element.dataset.status = status
  card.status.textContent = status === 'pending' ? 'running' : status === 'pass' ? 'passed' : 'failed'
  card.checks.replaceChildren(
    ...(run?.checks ?? []).map((check) => {
      const item = el('li', check.status)
      item.append(el('span', 'icon', ICON[check.status]), el('span', 'label', check.label))
      if (check.detail) item.append(el('span', 'detail', check.detail))
      return item
    }),
  )
  card.log.textContent = run?.logs.join('\n') ?? ''
  const link = toc.querySelector<HTMLElement>(`a[href="#${card.definition.id}"]`)
  if (link) link.dataset.status = status
}

let summaryQueued = false
function renderSummary() {
  if (summaryQueued) return
  summaryQueued = true
  requestAnimationFrame(() => {
    summaryQueued = false
    const counts = { pass: 0, fail: 0, pending: 0 }
    for (const card of cards) counts[statusOf(card.run)]++
    summary.replaceChildren(
      el('span', 'pass', `${counts.pass} passed`),
      el('span', 'fail', `${counts.fail} failed`),
      el('span', 'pending', `${counts.pending} running`),
      el('span', 'total', `${cards.length} cases`),
    )
  })
}

function start(card: Card) {
  card.run?.stop()
  card.run = runCase(card.definition, card.stage, card.readouts, images, throttleSelect.value, () => {
    render(card)
    renderSummary()
  })
  render(card)
  renderSummary()
}

function build() {
  let group = ''
  let section: HTMLElement | undefined
  let tocList: HTMLElement | undefined
  for (const definition of CASES) {
    if (definition.group !== group) {
      group = definition.group
      section = el('section', 'group')
      section.append(el('h2', undefined, group))
      casesElement.append(section)
      const tocGroup = el('div', 'toc-group')
      tocGroup.append(el('strong', undefined, group))
      tocList = el('div', 'toc-links')
      tocGroup.append(tocList)
      toc.append(tocGroup)
    }
    const element = el('article', 'case')
    element.id = definition.id
    const head = el('header')
    const title = el('h3', undefined, definition.title)
    const status = el('span', 'status')
    const again = el('button', 'again', 'Run again')
    again.type = 'button'
    head.append(title, status, again)
    const about = el('p', 'about', definition.about)
    const body = el('div', 'body')
    const stage = el('div', 'stage')
    const side = el('div', 'side')
    const checks = el('ol', 'checks')
    const readouts = el('div', 'readouts')
    const details = el('details', 'events')
    details.append(el('summary', undefined, 'Event log'))
    const log = el('pre')
    details.append(log)
    side.append(checks, readouts, details)
    body.append(stage, side)
    element.append(head, about, body)
    section!.append(element)
    const link = el('a', undefined, definition.title)
    link.href = `#${definition.id}`
    tocList!.append(link)
    const card: Card = { definition, element, stage, readouts, checks, log, status }
    again.addEventListener('click', () => start(card))
    cards.push(card)
  }
}

const runAll = () => cards.forEach(start)

async function loadImages(): Promise<SourceImage[]> {
  // On the first start the server is still generating the images.
  for (;;) {
    try {
      const response = await fetch('/api/images')
      if (response.ok) return (await response.json()) as SourceImage[]
    } catch {
      // Retried below.
    }
    summary.textContent = 'Waiting for the demo server…'
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

/** Explains the filmstrip colors once, under the summary. */
function legend() {
  const element = el('div', 'legend')
  element.append(el('span', undefined, 'Filmstrips, one cell per frame:'))
  const kinds: [string, string][] = [
    ['placeholder', 'placeholder'],
    ['loading', 'visible while loading'],
    ['fading', 'fading in'],
    ['image', 'image'],
    ['broken', 'alt text or broken icon'],
  ]
  for (const [kind, text] of kinds) {
    const item = el('span', undefined, text)
    item.prepend(el('i', `f-${kind}`))
    element.append(item)
  }
  summary.after(element)
}

build()
legend()
images = await loadImages()
document.getElementById('run-all')!.addEventListener('click', runAll)
throttleSelect.addEventListener('change', runAll)
runAll()
