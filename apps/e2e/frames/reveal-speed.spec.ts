/**
 * The top bar's reveal speed applies to every image on the demo page: the
 * placeholder tiles, the template HTML, the React use cases and the hero
 * route in its frame. Every fade that runs, a CSS transition or a Web
 * Animation on an image, lasts what the bar chose; nothing keeps a duration
 * of its own.
 */
import { expect, test, type Frame } from '@playwright/test'

const CHOSEN = 150

/** The durations of the fades running on images in a frame right now, in ms. */
const running = (frame: Frame) =>
  frame
    .evaluate(() => {
      const durations: number[] = []
      for (const animation of document.getAnimations()) {
        const target = (animation.effect as KeyframeEffect | null)?.target
        if (target instanceof HTMLImageElement) durations.push(Number(animation.effect!.getTiming().duration))
      }
      for (const img of document.querySelectorAll('img')) {
        const match = /opacity (\d+(?:\.\d+)?)(m?s)/.exec(img.style.transition)
        if (match) durations.push(Number(match[1]) * (match[2] === 's' ? 1000 : 1))
      }
      return durations
    })
    .catch(() => [] as number[])

test('every image fades at the reveal speed the top bar chose', async ({ page }) => {
  await page.addInitScript((ms) => localStorage.setItem('le-fade', String(ms)), CHOSEN)
  await page.goto('/')
  await expect(page.locator('.site [data-fade]')).toHaveValue(String(CHOSEN))

  const seen = new Set<number>()
  const sample = async () => {
    for (const frame of page.frames()) for (const ms of await running(frame)) seen.add(ms)
  }
  // Down the page, so every lazy image comes into view and fades.
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < height; y += 300) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    for (let i = 0; i < 8; i++) {
      await sample()
      await page.waitForTimeout(40)
    }
  }
  for (let i = 0; i < 40; i++) {
    await sample()
    await page.waitForTimeout(40)
  }

  expect(seen.size, 'some fades ran').toBeGreaterThan(0)
  expect([...seen]).toEqual([CHOSEN])
})
