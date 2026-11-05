import { expect, test, type Locator } from '@playwright/test'
import sharp from 'sharp'
import { FOCUS } from '../src/focus.js'
import { trackImageRequests, waitForHydration } from './helpers.js'

// Spec 5.4: the focal point sits as close to the box center as the image
// edges allow, whether the server crops or only the browser does.

/** Where the fixture's blue dot is drawn inside `box`, in CSS px. */
async function dotCenter(box: Locator): Promise<{ x: number; y: number }> {
  const png = await box.screenshot({ animations: 'disabled', scale: 'css' })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let sx = 0
  let sy = 0
  let count = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      if (data[i + 2]! > 180 && data[i]! < 90 && data[i + 1]! < 90) {
        sx += x
        sy += y
        count++
      }
    }
  }
  expect(count, 'the dot is visible').toBeGreaterThan(50)
  return { x: sx / count, y: sy / count }
}

/** The dot's expected place for a 1600×500 source drawn with cover in a `width × height` box. */
function expected(width: number, height: number): { x: number; y: number } {
  const ratio = 1600 / 500
  const rw = Math.max(width, height * ratio)
  const rh = Math.max(height, width / ratio)
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  const ox = clamp(width / 2 - (FOCUS.x / 100) * rw, width - rw, 0)
  const oy = clamp(height / 2 - (FOCUS.y / 100) * rh, height - rh, 0)
  return { x: ox + (FOCUS.x / 100) * rw, y: oy + (FOCUS.y / 100) * rh }
}

for (const width of [500, 900, 1280]) {
  test(`the browser centers the focal point of an uncropped image at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    const requests = trackImageRequests(page)
    await page.goto('/focus')
    const banner = page.locator('.focus-banner')
    await expect(banner).toHaveAttribute('data-state', 'loaded')
    const dot = await dotCenter(banner)
    const target = expected(width, 200)
    expect(Math.abs(dot.x - target.x), `x ${dot.x} vs ${target.x}`).toBeLessThan(3)
    expect(Math.abs(dot.y - target.y), `y ${dot.y} vs ${target.y}`).toBeLessThan(3)
    // Not cropped on the server: no fx/fy in the banner's URLs.
    expect(requests.filter((url) => url.includes('focus.png') && !url.includes('ar=')).length).toBeGreaterThan(0)
    expect(requests.filter((url) => !url.includes('ar=')).every((url) => !url.includes('fx='))).toBe(true)
  })
}

test('the server crops around the focal point', async ({ page }) => {
  const requests = trackImageRequests(page)
  await page.goto('/focus')
  await waitForHydration(page)
  const avatar = page.locator('.focus-avatar')
  await avatar.scrollIntoViewIfNeeded()
  await expect(avatar).toHaveAttribute('data-state', 'loaded')
  expect(requests.some((url) => url.includes('ar=1&') && url.includes('fx=70&fy=60'))).toBe(true)
  // The 500×500 window keeps the full height and is centered on x = 1120,
  // so the dot is centered horizontally and stays at 60 % vertically.
  const dot = await dotCenter(avatar)
  expect(Math.abs(dot.x - 100), `x ${dot.x}`).toBeLessThan(3)
  expect(Math.abs(dot.y - 120), `y ${dot.y}`).toBeLessThan(3)
})

test('the server HTML already places an uncropped image', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  // No hydration: what the browser paints from the HTML alone.
  await page.route('**/client.js', (route) => route.abort())
  await page.goto('/focus', { waitUntil: 'load' })
  const dot = await dotCenter(page.locator('.focus-banner'))
  const target = expected(1280, 200)
  expect(Math.abs(dot.x - target.x)).toBeLessThan(3)
  expect(Math.abs(dot.y - target.y)).toBeLessThan(3)
})

test('fixed and ratio boxes keep their size as size containers', async ({ page }) => {
  await page.goto('/focus')
  await waitForHydration(page)
  expect(await page.locator('.focus-fixed').boundingBox()).toMatchObject({ width: 160, height: 120 })
  expect(await page.locator('.focus-ratio').boundingBox()).toMatchObject({ width: 300, height: 150 })
})
