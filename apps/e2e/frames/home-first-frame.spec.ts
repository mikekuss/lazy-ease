/**
 * The start page's placeholder tiles paint with the first HTML: the
 * prerender plugin writes each placeholder inline, so no frame shows an
 * empty box before the page script runs. Checked with scripting off, which
 * is the first HTML as it paints.
 */
import { expect, test } from '@playwright/test'

/** The box's own background in apps/demo/index.html, i.e. an empty tile. */
const EMPTY = 'rgb(229, 231, 235)'

test.use({ javaScriptEnabled: false })

test('every start page tile shows its placeholder in the first HTML', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const boxes = page.locator('.kind [data-le]')
  await expect(boxes).toHaveCount(5)
  const tiles = await boxes.evaluateAll((all) =>
    all.map((box) => {
      const style = getComputedStyle(box)
      const rect = box.getBoundingClientRect()
      return { kind: (box as HTMLElement).dataset.kind, image: style.backgroundImage, color: style.backgroundColor, height: rect.height }
    }),
  )
  for (const tile of tiles) {
    expect(tile.height, `${tile.kind} reserves its height`).toBeGreaterThan(50)
    expect(tile.image !== 'none' || tile.color !== EMPTY, `${tile.kind} paints a placeholder, not an empty box`).toBe(true)
  }
  // The ThumbHash tiles paint the decoded image itself, not only its color.
  for (const kind of ['svg', 'png', 'focus', 'uri']) {
    expect(tiles.find((tile) => tile.kind === kind)?.image, kind).toMatch(/^url\("data:image\//)
  }
})
