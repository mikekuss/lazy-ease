import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers.js'

interface Sample {
  time: number
  opacity: string
  state: string | undefined
  complete: boolean
}

declare global {
  interface Window {
    __samples?: Sample[]
  }
}

// Spec 9: a measured-mode image stays at opacity 0 until it has loaded and
// decoded, so a partially downloaded image is never visible.
test('no progressive paint: opacity 0 until load and decode, then 1', async ({ page, context, baseURL }) => {
  // Every image response streams over 2 s.
  await context.addCookies([{ name: 'e2e-throttle', value: '0:2000', url: baseURL! }])
  // Samples every frame from the moment the component sets srcset. The
  // interval keeps sampling where a loaded machine throttles frames.
  await page.addInitScript(() => {
    const samples: Sample[] = []
    window.__samples = samples
    const sample = () => {
      const box = document.querySelector<HTMLElement>('.fade-box')
      const img = box?.querySelector('img')
      if (box && img?.getAttribute('srcset')) {
        const opacity = getComputedStyle(img).opacity
        samples.push({ time: performance.now(), opacity, state: box.dataset.state, complete: img.complete })
      }
    }
    const tick = () => {
      sample()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    setInterval(sample, 20)
  })

  await page.goto('/fade')
  await waitForHydration(page)
  const box = page.locator('.fade-box')
  await expect(box).toHaveAttribute('data-state', 'loaded', { timeout: 20_000 })
  await expect.poll(() => page.locator('.fade-box > img').evaluate((img) => getComputedStyle(img).opacity)).toBe('1')

  const samples = (await page.evaluate(() => window.__samples))!
  const pending = samples.filter((sample) => sample.state !== 'loaded')
  // The throttled window was observed for over a second, with the download still running.
  const downloading = pending.filter((sample) => !sample.complete)
  expect(downloading.length).toBeGreaterThan(5)
  expect(downloading.at(-1)!.time - downloading[0]!.time).toBeGreaterThan(1000)
  expect(pending.filter((sample) => sample.opacity !== '0')).toEqual([])
})
