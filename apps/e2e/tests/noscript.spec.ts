import { expect, test } from '@playwright/test'
import { NO_SCRIPT } from '../src/pages.js'
import { waitForHydration } from './helpers.js'

// `noScript` with scripting disabled: the fallback img and the inert
// placeholder img share one reserved slot, also for a hard swap, which
// needs no box without the fallback.
const ids = Object.keys(NO_SCRIPT) as (keyof typeof NO_SCRIPT)[]
// Fixed boxes are 320×240; intrinsic ones reserve the photo's 3:2.
const slotOf = (id: keyof typeof NO_SCRIPT) => {
  const props = NO_SCRIPT[id]
  return { width: 320, height: 'height' in props ? props.height : Math.round(320 / 1.5) }
}

test.describe('scripting disabled', () => {
  test.use({ javaScriptEnabled: false })

  for (const id of ids) {
    test(`the fallback covers the placeholder in one slot (${id})`, async ({ page }) => {
      await page.goto('/noscript')
      const slot = page.locator(`#${id}`)
      // The second img, from the noscript element.
      const fallback = slot.locator('img').nth(1)
      expect(await fallback.evaluate((img) => img.parentElement!.localName)).toBe('noscript')
      await expect.poll(() => fallback.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
      const rect = (element: Element) => {
        const { top, left, width, height } = element.getBoundingClientRect()
        return { top, left, width, height }
      }
      const area = await slot.evaluate(rect)
      expect({ width: area.width, height: Math.round(area.height) }).toEqual(slotOf(id))
      // Both imgs fill the same area: the fallback lies over the placeholder, not below it.
      for (const img of await slot.locator('img').all()) expect(await img.evaluate(rect)).toEqual(area)
    })
  }

  test('a fallback without a reserved height takes its own and covers nothing after it', async ({ page }) => {
    await page.goto('/noscript')
    const slot = page.locator('#unsized')
    const fallback = slot.locator('noscript img')
    await expect.poll(() => fallback.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
    const box = await slot.locator('[data-le]').evaluate((element) => element.getBoundingClientRect().toJSON())
    const image = await fallback.evaluate((element) => element.getBoundingClientRect().toJSON())
    const inert = await slot.locator('img').first().evaluate((element) => element.getBoundingClientRect().toJSON())
    const after = await page.locator('#after').evaluate((element) => element.getBoundingClientRect().toJSON())
    expect({ width: image.width, height: image.height }).toEqual({ width: 320, height: 640 })
    // One slot: the inert img lies under the fallback, at the top of the same box.
    expect(inert.top).toBe(image.top)
    expect(box.height).toBe(640)
    expect(after.top).toBeGreaterThanOrEqual(image.bottom)
  })
})

test('with scripting, the same page reserves the same slots and loads every image once', async ({ page }) => {
  await page.goto('/noscript')
  await waitForHydration(page)
  for (const id of ids) {
    const slot = page.locator(`#${id}`)
    await expect(slot.locator('[data-le]')).toHaveAttribute('data-state', 'loaded')
    expect(Math.round(await slot.evaluate((element) => element.getBoundingClientRect().height))).toBe(slotOf(id).height)
    expect(await slot.locator('img').count()).toBe(1)
  }
})
