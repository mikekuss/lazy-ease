/**
 * The demo page's placeholder tiles paint with the first HTML: the prerender
 * plugin writes each placeholder inline, so no frame shows an empty box
 * before the page script runs. Checked with scripting off, which is the
 * first HTML as it paints.
 */
import { expect, test } from '@playwright/test'

/** The well behind a box (apps/demo/src/tiles/tiles.css), i.e. an empty tile. */
const EMPTY = 'rgba(0, 0, 0, 0)'

test.use({ javaScriptEnabled: false })

test('every placeholder tile shows its placeholder in the first HTML', async ({ page }) => {
  // Load, so the render-blocking stylesheets apply as they do before the first paint.
  await page.goto('/', { waitUntil: 'load' })
  const boxes = page.locator('.tile [data-le]')
  await expect(boxes).toHaveCount(11)
  const tiles = await boxes.evaluateAll((all) =>
    all.map((box) => {
      const style = getComputedStyle(box)
      const title = box.closest('.tile')!.querySelector('b')!.textContent
      return { title, image: style.backgroundImage, color: style.backgroundColor, height: box.getBoundingClientRect().height }
    }),
  )
  for (const tile of tiles) {
    expect(tile.height, `${tile.title} reserves its height`).toBeGreaterThan(50)
    // "None" shows placeholder="none": no placeholder, on purpose.
    if (tile.title === 'None') continue
    expect(tile.image !== 'none' || tile.color !== EMPTY, `${tile.title} paints a placeholder, not an empty box`).toBe(true)
  }
  // The color tiles start as a plain color; every other tile with a placeholder paints an image.
  for (const tile of tiles.filter((tile) => !['Color', 'SSR color', 'None'].includes(tile.title!))) {
    expect(tile.image, tile.title!).toMatch(/^url\("data:image\//)
  }
})
