import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { waitForHydration } from './helpers.js'

// focusReveal starts a 1000 px image at an 80 px blur. The React wrapper does
// not clip, so the reveal clips the blur to the image's box itself.
test('the focus reveal paints nothing outside the image box', async ({ page }) => {
  await page.goto('/reveal')
  await waitForHydration(page)
  const box = page.locator('.reveal-box')
  await expect(box).toHaveAttribute('data-state', 'loaded', { timeout: 20_000 })
  // Holds the 20 s fade where the image is opaque and still blurred (45 %), transition included.
  await page.locator('.reveal-box > img').evaluate((img) => {
    for (const animation of img.getAnimations()) {
      animation.pause()
      animation.currentTime = 9000
    }
  })
  const { filter, opacity } = await page.locator('.reveal-box > img').evaluate((img) => {
    const style = getComputedStyle(img)
    return { filter: style.filter, opacity: style.opacity }
  })
  expect(filter).toMatch(/blur\((?!0px)/)
  expect(Number(opacity)).toBeGreaterThan(0.9)

  const rect = (await box.boundingBox())!
  const png = await page.screenshot({ clip: { x: rect.x - 60, y: rect.y - 60, width: rect.width + 120, height: rect.height + 120 }, scale: 'css' })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  // A frame 3 to 60 px outside the box, where an unclipped blur reaches.
  const outside: string[] = []
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const inner = x >= 57 && x < info.width - 57 && y >= 57 && y < info.height - 57
      if (inner) continue
      const i = (y * info.width + x) * info.channels
      if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) outside.push(`${x},${y}`)
    }
  }
  expect(outside.slice(0, 5), `${outside.length} pixels outside the box are not white`).toEqual([])
})
