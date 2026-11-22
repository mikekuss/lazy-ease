import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { waitForHydration } from './helpers.js'

/** Holds the 20 s fade of a loaded reveal where the image is opaque and still blurred (45 %), transition included. */
async function hold(page: Page, wrapper: string) {
  const box = page.locator(wrapper)
  await expect(box).toHaveAttribute('data-state', 'loaded', { timeout: 20_000 })
  const img = page.locator(`${wrapper} > img`)
  await img.evaluate((img) => {
    for (const animation of img.getAnimations()) {
      animation.pause()
      animation.currentTime = 9000
    }
  })
  const { filter, opacity } = await img.evaluate((img) => {
    const style = getComputedStyle(img)
    return { filter: style.filter, opacity: style.opacity }
  })
  expect(filter).toMatch(/blur\((?!0px)/)
  expect(Number(opacity)).toBeGreaterThan(0.9)
  return (await box.boundingBox())!
}

/** The pixels of a page region that `inside` excludes and that are not white, as "x,y". */
async function painted(page: Page, clip: { x: number; y: number; width: number; height: number }, inside: (x: number, y: number) => boolean) {
  const png = await page.screenshot({ clip, scale: 'css' })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const found: string[] = []
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (inside(x, y)) continue
      const i = (y * info.width + x) * info.channels
      if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) found.push(`${x},${y}`)
    }
  }
  return found
}

// focusReveal starts a 1000 px image at an 80 px blur. The React wrapper does
// not clip, so the reveal contains the blur to the image's box itself.
test('the focus reveal paints nothing outside the image box', async ({ page }) => {
  await page.goto('/reveal')
  await waitForHydration(page)
  const rect = await hold(page, '.reveal-box')
  const clip = { x: rect.x - 60, y: rect.y - 60, width: rect.width + 120, height: rect.height + 120 }
  // A frame 3 to 60 px outside the box, where an uncontained blur reaches.
  const outside = await painted(page, clip, (x, y) => x >= 57 && x < clip.width - 57 && y >= 57 && y < clip.height - 57)
  expect(outside.slice(0, 5), `${outside.length} pixels outside the box are not white`).toEqual([])
})

// The avatar clips itself to circle(40%) and has no placeholder: during the
// reveal only the circle may paint, not the corners of its box.
test('the focus reveal keeps the clip-path of the image', async ({ page }) => {
  await page.goto('/reveal')
  await waitForHydration(page)
  const rect = await hold(page, '.reveal-avatar')
  const clip = { x: rect.x - 40, y: rect.y - 40, width: rect.width + 80, height: rect.height + 80 }
  // circle(40%) of a square box: a radius of 40 % of its side, around its center; 3 px of antialiasing.
  const radius = rect.width * 0.4 + 3
  const outside = await painted(page, clip, (x, y) => Math.hypot(x - clip.width / 2, y - clip.height / 2) < radius)
  expect(outside.slice(0, 5), `${outside.length} pixels outside the circle are not white`).toEqual([])
})
