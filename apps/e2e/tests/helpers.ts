import type { Page } from '@playwright/test'
import { thumbHashToAverageRGBA } from 'thumbhash'
import type { PageData } from '../src/pages.js'

export const LADDER = [64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840]

/** Smallest ladder width that is at least `width`, as the component snaps. */
export function snap(width: number): number {
  return LADDER.find((w) => w >= width) ?? LADDER[LADDER.length - 1]!
}

/** The `w` parameter of an image URL. */
export function widthOf(url: string): number {
  return Number(new URL(url, 'http://x').searchParams.get('w'))
}

/** Every `/_img` request the page makes from now on, as absolute URLs. */
export function trackImageRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/_img/')) urls.push(request.url())
  })
  return urls
}

/** Console warnings and errors, plus uncaught exceptions. */
export function trackConsole(page: Page): { warnings: string[]; errors: string[] } {
  const log = { warnings: [] as string[], errors: [] as string[] }
  page.on('console', (message) => {
    if (message.type() === 'warning') log.warnings.push(message.text())
    if (message.type() === 'error') log.errors.push(message.text())
  })
  page.on('pageerror', (error) => log.errors.push(error.message))
  return log
}

export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__hydrated === true)
}

/** The data the server rendered the page with, read from its HTML. */
export function pageData(html: string): PageData {
  const json = /<script id="data" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1]
  if (!json) throw new Error('No page data in the HTML')
  return JSON.parse(json) as PageData
}

/** The inline style of the box with `className` in server HTML. */
export function boxStyle(html: string, className: string): string {
  const style = new RegExp(`<span class="${className}" data-state="[a-z]+" style="([^"]*)"`).exec(html)?.[1]
  if (style === undefined) throw new Error(`No box .${className} in the HTML`)
  return style
}

/** The ThumbHash average color as the component renders it, and as `rgb()` the way getComputedStyle reports it. */
export function averageColor(hash: string): { hex: string; rgb: string } {
  const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
  const { r, g, b } = thumbHashToAverageRGBA(bytes)
  const rgb = [r, g, b].map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255))
  return {
    hex: `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
    rgb: `rgb(${rgb.join(', ')})`,
  }
}
