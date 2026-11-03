import { expect, test } from '@playwright/test'
import { trackImageRequests, waitForHydration } from './helpers.js'

// Spec 1 goal 3 and 7.1: measured-mode lazy images load only near the viewport.
test('no image requests below the fold until the box nears the viewport', async ({ page }) => {
  const requests = trackImageRequests(page)
  await page.goto('/below-fold')
  await waitForHydration(page)
  // Room for a late IntersectionObserver callback or a stray preload.
  await page.waitForTimeout(500)

  expect(requests).toEqual([])
  for (const n of [1, 2, 3]) await expect(page.locator(`.below-${n}`)).toHaveAttribute('data-state', 'idle')
  await expect(page.locator('.below-1 > img')).not.toHaveAttribute('srcset', /./)

  // 300 px below the viewport: inside the default 400px rootMargin, not yet visible.
  const top = await page.locator('.below-1').evaluate((box) => box.getBoundingClientRect().top + window.scrollY)
  await page.evaluate((y) => window.scrollTo(0, y), top - 720 - 300)
  await expect(page.locator('.below-1')).toHaveAttribute('data-state', 'loaded')
  expect(await page.locator('.below-1').evaluate((box) => box.getBoundingClientRect().top)).toBeGreaterThan(720)
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((url) => new URL(url).pathname.startsWith('/_img/copy-'))).toBe(true)
})
