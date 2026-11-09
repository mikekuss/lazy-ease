import { expect, test, type Page } from '@playwright/test'
import { trackConsole, trackImageRequests } from './helpers.js'

// The static fixture apps/e2e/static/vanilla.html: what a PHP template emits
// for @lazy-ease/vanilla, served with the script and stylesheet at the paths
// the recipes use.

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

/** The fixture with its HTML changed on the way, e.g. without the loader configuration. */
async function gotoChanged(page: Page, change: (html: string) => string) {
  await page.route('**/vanilla', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: change(await response.text()) })
  })
  await page.goto('/vanilla')
}

const box = (page: Page, id: string) => page.locator(`#${id}`)
const img = (page: Page, id: string) => page.locator(`#${id} img`)
const currentSrc = (page: Page, id: string) => img(page, id).evaluate((element: HTMLImageElement) => element.currentSrc)

/** Scrolls `id` into view and waits until its image is displayed. */
async function shown(page: Page, id: string) {
  await box(page, id).scrollIntoViewIfNeeded()
  await expect(box(page, id)).toHaveAttribute('data-state', 'loaded', { timeout: 20_000 })
  await expect.poll(() => img(page, id).evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
}

test('native HTML loads without scripts; deferred images keep their placeholder', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
  const page = await context.newPage()
  const requests = trackImageRequests(page)
  await page.goto('/vanilla')
  await expect.poll(() => img(page, 'native').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBeGreaterThan(0)
  await box(page, 'measured').scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  for (const id of ['prepared', 'single', 'picture', 'measured']) {
    await expect(img(page, id)).toHaveAttribute('src', INERT)
    await expect(box(page, id)).not.toHaveAttribute('data-state', /./)
  }
  expect(requests.every((url) => url.includes('/_img/photo.jpg?fmt=webp'))).toBe(true)
  await context.close()
})

test('the script enhances only the opted-in area, from the template’s own URLs', async ({ page }) => {
  const log = trackConsole(page)
  const assets: Record<string, number> = {}
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (pathname.startsWith('/assets/')) assets[pathname] = response.status()
  })
  await page.goto('/vanilla')
  await expect(box(page, 'native')).toHaveAttribute('data-state', 'loaded')
  expect(assets).toEqual({ '/assets/lazy-ease.css': 200, '/assets/lazy-ease.min.js': 200 })
  // The stylesheet makes the span a block whose img covers it.
  expect(await box(page, 'prepared').evaluate((element) => getComputedStyle(element).display)).toBe('block')

  await shown(page, 'prepared')
  expect(await currentSrc(page, 'prepared')).toMatch(/\/_img\/copy-1\.jpg\?fmt=webp&q=75&w=(640|1080)$/)
  await shown(page, 'single')
  expect(await currentSrc(page, 'single')).toMatch(/\/_img\/copy-2\.jpg\?fmt=webp&q=75&w=640$/)
  // 1280 px wide: the wide source of the picture wins.
  await shown(page, 'picture')
  expect(await currentSrc(page, 'picture')).toContain('/_img/copy-1.jpg?ar=2&fmt=webp')
  await shown(page, 'measured')
  expect(await currentSrc(page, 'measured')).toMatch(/\/_img\/photo\.jpg\?ar=1\.5&fmt=webp&q=75&w=\d+$/)

  const banner = page.locator('#banner')
  await banner.scrollIntoViewIfNeeded()
  await expect(banner).toHaveAttribute('data-le-visible', '')
  await expect.poll(() => banner.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('copy-3.jpg')

  for (const id of ['managed', 'outside']) {
    await box(page, id).scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await expect(box(page, id)).not.toHaveAttribute('data-state', /./)
    await expect(img(page, id)).toHaveAttribute('src', INERT)
  }
  expect(log.errors).toEqual([])
})

test('prepared images need no loader, no measuring and no format probe', async ({ page }) => {
  const log = trackConsole(page)
  await page.addInitScript(() => {
    const counts = { resizeObservers: 0, images: 0 }
    ;(window as unknown as { __counts: typeof counts }).__counts = counts
    const NativeResizeObserver = window.ResizeObserver
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback)
        counts.resizeObservers++
      }
    }
    const NativeImage = window.Image
    window.Image = class extends NativeImage {
      constructor(width?: number, height?: number) {
        super(width, height)
        counts.images++
      }
    }
  })
  const requests = trackImageRequests(page)
  // No loader configured, and no measured image on the page.
  await gotoChanged(page, (html) => html.replace(' data-base-url="/_img" data-formats="webp"', '').replace(/<!-- Measured:[\s\S]*?<\/div>\n/, ''))
  await expect(page.locator('#measured')).toHaveCount(0)
  for (const id of ['prepared', 'single', 'picture']) await shown(page, id)
  expect(await page.evaluate(() => (window as unknown as { __counts: object }).__counts)).toEqual({ resizeObservers: 0, images: 0 })
  // Every image URL comes from the HTML or the author's CSS (the banner).
  const prepared = await page.evaluate(() => [
    ...[...document.querySelectorAll('img, source')].flatMap((element) => [
      element.getAttribute('src'),
      ...(element.getAttribute('srcset') ?? '').split(',').map((candidate) => candidate.trim().split(' ')[0]),
    ]),
    ...[...document.querySelector('style')!.textContent!.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]),
  ])
  for (const url of requests) expect(prepared, url).toContain(new URL(url).pathname + new URL(url).search)
  expect(log.errors).toEqual([])
})

test('two copies of the script on one page attach each image once', async ({ page }) => {
  const log = trackConsole(page)
  // Each copy scans the opted-in areas once when it starts: count the scans.
  await page.addInitScript(() => {
    const scan = Document.prototype.querySelectorAll
    const counter = window as unknown as { leScans: number }
    counter.leScans = 0
    Document.prototype.querySelectorAll = function (this: Document, selector: string) {
      if (selector === '[data-le-auto]') counter.leScans++
      return scan.call(this, selector)
    } as typeof scan
  })
  const scripts: Record<string, number> = {}
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname === '/assets/lazy-ease.min.js') scripts[url.search] = response.status()
  })
  await gotoChanged(page, (html) =>
    html.replace(/(<script defer src="\/assets\/lazy-ease\.min\.js"[^>]*><\/script>)/, '$1\n<script defer src="/assets/lazy-ease.min.js?copy=2" data-base-url="/_img" data-formats="webp"></script>'),
  )
  await expect(box(page, 'native')).toHaveAttribute('data-state', 'loaded')
  for (const id of ['prepared', 'picture', 'measured']) await shown(page, id)
  const banner = page.locator('#banner')
  await banner.scrollIntoViewIfNeeded()
  await expect(banner).toHaveAttribute('data-le-visible', '')
  expect(scripts).toEqual({ '': 200, '?copy=2': 200 })
  expect(await page.evaluate(() => (window as unknown as { leScans: number }).leScans)).toBe(2)
  expect(log.errors).toEqual([])
})
