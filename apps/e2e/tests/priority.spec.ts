import { expect, test, type Page } from '@playwright/test'
import { trackConsole, trackImageRequests, waitForHydration, widthOf } from './helpers.js'

// Spec 6.3, 7.1, 9 and 11: the priority image's URLs are in the HTML, it is
// visible from the first paint and preloaded with high priority.
async function expectVisibleFromHtml(page: Page, requests: string[]) {
  const img = page.locator('.hero-box > img')
  const srcset = await img.getAttribute('srcset')
  expect(srcset).toMatch(/fmt=webp/)
  await expect(img).toHaveAttribute('src', /^\/_img\/photo\.jpg\?ar=2&fmt=webp&q=75&w=\d+$/)
  await expect(img).toHaveAttribute('sizes', '100vw')
  await expect(img).toHaveAttribute('fetchpriority', 'high')
  await expect(img).not.toHaveAttribute('loading', /./)
  await expect(img).toHaveCSS('opacity', '1')

  const preload = page.locator('head link[rel="preload"][as="image"]')
  await expect(preload).toHaveCount(1)
  await expect(preload).toHaveAttribute('imagesrcset', srcset!)
  await expect(preload).toHaveAttribute('imagesizes', '100vw')
  await expect(preload).toHaveAttribute('fetchpriority', 'high')
  // The img's src is the largest candidate, the fallback without srcset
  // support. React 19 drops href from a preload with imageSrcSet, so
  // browsers without imagesrcset support don't fetch it.
  const candidates = srcset!.split(', ').map((candidate) => candidate.split(' ')[0]!)
  await expect(img).toHaveAttribute('src', candidates.at(-1)!)
  await expect(preload).not.toHaveAttribute('href', /./)

  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  // 1280 CSS px at DPR 1, and the preload and the img share one request.
  await expect.poll(() => [...new Set(requests)].map(widthOf)).toEqual([1440])
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the priority image is visible', async ({ page }) => {
    const requests = trackImageRequests(page)
    await page.goto('/priority')
    await expectVisibleFromHtml(page, requests)
  })
})

test('the priority image is visible before hydration, and stays so after', async ({ page }) => {
  const requests = trackImageRequests(page)
  const log = trackConsole(page)
  let hydrate!: () => void
  const held = new Promise<void>((resolve) => (hydrate = resolve))
  await page.route('**/client.js', async (route) => {
    await held
    await route.continue()
  })

  // The held defer script also holds DOMContentLoaded.
  await page.goto('/priority', { waitUntil: 'commit' })
  await expectVisibleFromHtml(page, requests)
  expect(await page.evaluate(() => window.__hydrated)).toBeUndefined()

  hydrate()
  await waitForHydration(page)
  await expect(page.locator('.hero-box')).toHaveAttribute('data-state', 'loaded')
  await expect(page.locator('.hero-box > img')).toHaveCSS('opacity', '1')
  expect([...new Set(requests)].map(widthOf)).toEqual([1440])
  expect(log.errors).toEqual([])
})
