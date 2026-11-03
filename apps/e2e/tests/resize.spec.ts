import { expect, test } from '@playwright/test'
import { trackImageRequests, waitForHydration, widthOf } from './helpers.js'

// Spec 6.2 step 4: a growing box raises `sizes` (debounced 200 ms, only when
// the snapped candidate changes), and the attribute mutation makes every
// engine, WebKit included, select the larger candidate. `sizes` never drops.
test.use({ viewport: { width: 500, height: 700 } })

declare global {
  interface Window {
    /** ms from the resize event to the `sizes` write. */
    __sizesDelay?: Promise<number>
  }
}

test('upgrades through the sizes mutation and never lowers sizes', async ({ page }) => {
  const requests = trackImageRequests(page)
  const box = page.locator('.fluid-box')
  const img = page.locator('.fluid-box > img')
  const currentWidth = async () => widthOf(await img.evaluate((el: HTMLImageElement) => el.currentSrc))

  await page.goto('/resize')
  await waitForHydration(page)
  await expect(box).toHaveAttribute('data-state', 'loaded')
  await expect(img).toHaveAttribute('sizes', '500px')
  expect(await currentWidth()).toBe(640)

  // 600 px still selects 640: no write.
  await page.setViewportSize({ width: 600, height: 700 })
  await page.waitForTimeout(600)
  await expect(img).toHaveAttribute('sizes', '500px')
  expect(requests.map(widthOf)).toEqual([640])

  // 900 px selects 1080. Timed in the page, since setViewportSize can return
  // late under load: the write comes at least one debounce after the resize.
  await page.evaluate(() => {
    window.__sizesDelay = new Promise<number>((resolve) => {
      const image = document.querySelector('.fluid-box > img')!
      let resizedAt = 0
      window.addEventListener('resize', () => (resizedAt ||= performance.now()))
      new MutationObserver(() => resolve(performance.now() - resizedAt)).observe(image, { attributeFilter: ['sizes'] })
    })
  })
  await page.setViewportSize({ width: 900, height: 700 })
  expect(await page.evaluate(() => window.__sizesDelay)).toBeGreaterThanOrEqual(190)
  await expect(img).toHaveAttribute('sizes', '900px')
  await expect.poll(() => requests.map(widthOf)).toEqual([640, 1080])
  await expect.poll(currentWidth).toBe(1080)
  await expect(box).toHaveAttribute('data-state', 'loaded')

  // Shrinking leaves sizes alone, so no engine considers a downgrade.
  await page.setViewportSize({ width: 400, height: 700 })
  await page.waitForTimeout(600)
  await expect(img).toHaveAttribute('sizes', '900px')
  expect(requests.map(widthOf)).toEqual([640, 1080])
  expect(await currentWidth()).toBe(1080)
})
