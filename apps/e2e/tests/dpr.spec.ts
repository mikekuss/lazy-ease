import { expect, test, type Page } from '@playwright/test'
import { LADDER, snap, trackImageRequests, waitForHydration, widthOf } from './helpers.js'

// Spec 6.2 step 3: the browser takes snap(w × DPR) from the measured srcset,
// which stops at snap(2w) and at srcWidth.
const boxes = [
  { className: 'box-300', width: 300, file: 'photo.jpg', srcWidth: 2400 },
  { className: 'box-200-src-500', width: 200, file: 'small.jpg', srcWidth: 500 },
]

/** Largest ladder width at or below `srcWidth`. */
const sourceCap = (srcWidth: number) => LADDER.findLast((w) => w <= srcWidth)!

async function srcsetWidths(page: Page, className: string): Promise<number[]> {
  const srcset = (await page.locator(`.${className} > img`).getAttribute('srcset')) ?? ''
  return srcset.split(', ').map((candidate) => Number(candidate.split(' ')[1]!.slice(0, -1)))
}

for (const dpr of [1, 2, 3]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr })

    test('loads snap(width × DPR), capped at 2× and srcWidth', async ({ page }) => {
      const requests = trackImageRequests(page)
      await page.goto('/dpr')
      await waitForHydration(page)

      for (const { className, width, file, srcWidth } of boxes) {
        const cap = Math.min(snap(2 * width), sourceCap(srcWidth))
        const expected = Math.min(snap(width * dpr), cap)

        await expect(page.locator(`.${className}`)).toHaveAttribute('data-state', 'loaded')
        const img = page.locator(`.${className} > img`)
        await expect(img).toHaveAttribute('sizes', `${width}px`)
        expect(Math.max(...(await srcsetWidths(page, className)))).toBe(cap)
        expect(widthOf(await img.evaluate((el: HTMLImageElement) => el.currentSrc))).toBe(expected)
        // Only the chosen candidate went over the network.
        const fetched = requests.filter((url) => new URL(url).pathname === `/_img/${file}`).map(widthOf)
        expect(fetched).toEqual([expected])
      }
    })
  })
}
