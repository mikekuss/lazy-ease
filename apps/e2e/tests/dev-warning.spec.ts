import { expect, test } from '@playwright/test'
import { trackConsole, waitForHydration } from './helpers.js'

// Spec 6.2 "Cost" and 11: in development, a measured-mode image already
// intersecting the viewport at hydration logs a warning. Classic-mode and
// below-the-fold images don't.
test('warns for measured-mode images in the first viewport', async ({ page }) => {
  const log = trackConsole(page)
  await page.goto('/first-viewport')
  await waitForHydration(page)
  await page.waitForTimeout(200)

  const viewportWarnings = log.warnings.filter((text) => text.includes('in the first viewport'))
  expect(viewportWarnings).toHaveLength(1)
  expect(viewportWarnings[0]).toContain('/copy-1.jpg')
  expect(log.errors).toEqual([])
})
