/**
 * Two behaviours of the demo page itself: the top bar shows the network
 * speed the page loaded with, and the breakpoint case switches its box, not
 * only its image, to 2:1 from 800 px.
 */
import { expect, test } from '@playwright/test'

test('the network select shows the chosen speed after a reload', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'le-net', value: '3g', url: baseURL! }])
  await page.goto('/')
  await expect(page.locator('.site [data-net]')).toHaveValue('3g')
})

test('the breakpoint ratio box is 2:1 from 800 px and 4:3 below', async ({ page }) => {
  await page.goto('/#layout')
  const panel = page.locator('#layout')
  await panel.getByRole('combobox', { name: 'Layout' }).selectOption('ratio')
  const box = panel.locator('[data-le]').first()
  await expect(box).toHaveAttribute('data-state', 'loaded', { timeout: 15_000 })
  const ratio = () => box.evaluate((element) => element.getBoundingClientRect().width / element.getBoundingClientRect().height)
  expect(await ratio()).toBeCloseTo(2, 1)

  await page.setViewportSize({ width: 600, height: 900 })
  await expect.poll(ratio).toBeCloseTo(4 / 3, 1)
})
