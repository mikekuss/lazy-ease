import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deferred, doc, expect, img, shown, test } from './lab.js'

// What the loader must leave alone (SVG, GIF, external URLs), a native image
// and its preload sharing one request, failed loads with their alt text, and
// reduced motion.

const originals = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'images', 'extra')

test('SVG, animated GIF and external URLs load as they are, bypassing the loader', async ({ page, baseURL, lab }) => {
  // Another host for the same server: external to a page on 127.0.0.1.
  const external = `${baseURL!.replace('127.0.0.1', 'localhost')}${img('copy-1.jpg', 640)}`
  await lab.open(
    doc(
      ['/_img/extra/mark.svg', '/_img/extra/blink.gif', external]
        .map((src, i) => `<div class="card">${deferred(`direct-${i}`, { 'data-le-src': src, 'data-le-ar': '1.5', 'data-le-srcw': '1200', 'data-le-srch': '800' })}</div>`)
        .join('\n'),
    ),
  )
  for (const i of [0, 1, 2]) await shown(page, `direct-${i}`)
  for (const [i, src] of ['/_img/extra/mark.svg', '/_img/extra/blink.gif', external].entries()) {
    const element = page.locator(`#direct-${i} img`)
    await expect(element).toHaveAttribute('src', src)
    await expect(element).not.toHaveAttribute('srcset', /./)
    await expect(element).not.toHaveAttribute('sizes', /./)
  }
  // The originals, byte for byte, with every frame of the GIF.
  expect((await lab.imageHits()).sort()).toEqual(['/_img/extra/blink.gif', '/_img/extra/mark.svg', img('copy-1.jpg', 640)].sort())
  const decoded = Object.fromEntries((await lab.decoded()).map((entry) => [entry.url, entry]))
  expect(decoded['/_img/extra/mark.svg']).toMatchObject({ width: 120, height: 80, format: 'svg', bytes: (await readFile(path.join(originals, 'mark.svg'))).length })
  expect(decoded['/_img/extra/blink.gif']).toMatchObject({ width: 90, height: 60, format: 'gif', pages: 2, bytes: (await readFile(path.join(originals, 'blink.gif'))).length })
  expect(decoded[img('copy-1.jpg', 640)]).toMatchObject({ width: 640, height: 427, format: 'webp' })
})

test('a native image and its preload share one request', async ({ page, lab }) => {
  const srcset = [640, 1080, 1440, 1920].map((w) => `${img('photo.jpg', w, 'ar=2&')} ${w}w`).join(', ')
  const attr = (value: string) => value.replaceAll('&', '&amp;')
  await lab.open(
    doc(
      `<span data-le id="hero" style="aspect-ratio:2;background-color:#bbc8cf"><img alt="hero" width="2400" height="1200" fetchpriority="high"
  src="${attr(img('photo.jpg', 1920, 'ar=2&'))}" srcset="${attr(srcset)}" sizes="100vw"></span>`,
      { head: `<link rel="preload" as="image" fetchpriority="high" imagesrcset="${attr(srcset)}" imagesizes="100vw">` },
    ),
  )
  await expect(page.locator('#hero')).toHaveAttribute('data-state', 'loaded')
  await expect(page.locator('#hero img')).toHaveCSS('opacity', '1')
  // 1280 CSS px at DPR 1 select 1440w, for the preload and the img alike.
  expect(await lab.imageHits()).toEqual([img('photo.jpg', 1440, 'ar=2&')])
  // The one request is the preload's.
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/_img/')).map((entry) => (entry as PerformanceResourceTiming).initiatorType))).toEqual(['link'])
  const [decoded] = await lab.decoded()
  expect(decoded).toMatchObject({ width: 1440, height: 720 })
})

test('a failed first load shows the alt text in the reserved box, without the placeholder', async ({ page, lab }) => {
  const missing = '/_img/missing.jpg?fmt=webp&q=75&w=640'
  await lab.open(
    doc(
      `<div class="card">${deferred('prepared', { 'data-le-url': missing }, { alt: 'A footpath through the dunes' })}</div>
<div class="card">${deferred('measured', { 'data-le-src': '/missing.jpg', 'data-le-ar': '1.5', 'data-le-srcw': '1200', 'data-le-srch': '800' }, { alt: 'Cliffs' })}</div>`,
    ),
  )
  for (const id of ['prepared', 'measured']) {
    const box = page.locator(`#${id}`)
    await expect(box).toHaveAttribute('data-state', 'error')
    const shown = await box.evaluate((element) => {
      const image = element.querySelector('img')!
      const rect = element.getBoundingClientRect()
      return {
        size: [Math.round(rect.width), Math.round(rect.height)],
        background: element.style.backgroundColor,
        opacity: getComputedStyle(image).opacity,
        // The stylesheet hides a deferred image's alt text only until it errors.
        textColor: getComputedStyle(image).color,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
      }
    })
    expect(shown).toEqual({ size: [320, 213], background: '', opacity: '1', textColor: expect.not.stringMatching(/rgba\(0, 0, 0, 0\)|transparent/), complete: true, naturalWidth: 0 })
    await expect(box.locator('img')).toHaveAttribute('alt', id === 'prepared' ? 'A footpath through the dunes' : 'Cliffs')
  }
  expect((await lab.imageHits()).sort()).toEqual([missing, img('missing.jpg', 384, 'ar=1.5&')].sort())
})

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test.describe(`prefers-reduced-motion: ${reducedMotion}`, () => {
    test.use({ reducedMotion })

    test(reducedMotion === 'reduce' ? 'the image swaps in without a transition' : 'the image fades in over 400 ms', async ({ page, lab }) => {
      // Per frame from the display on: the img's inline transition and opacity, and the placeholder.
      await page.addInitScript(() => {
        const frames: { time: number; transition: string; opacity: string; placeholder: string }[] = []
        ;(window as unknown as { __frames: typeof frames }).__frames = frames
        const sample = () => {
          const box = document.getElementById('fade')
          const image = box?.querySelector('img')
          if (box?.getAttribute('data-state') === 'loaded' && image)
            frames.push({ time: performance.now(), transition: image.style.transition, opacity: getComputedStyle(image).opacity, placeholder: box.style.backgroundColor })
          if (frames.length < 2 || frames.at(-1)!.placeholder) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await lab.open(doc(`<div class="card">${deferred('fade', { 'data-le-url': img('copy-1.jpg', 640) })}</div>`))
      await shown(page, 'fade')
      // Until a frame after the release was sampled: a loaded machine can delay frames.
      await expect.poll(() => page.evaluate(() => (window as unknown as { __frames: { placeholder: string }[] }).__frames.some((frame) => !frame.placeholder))).toBe(true)
      const frames = await page.evaluate(() => (window as unknown as { __frames: { time: number; transition: string; opacity: string; placeholder: string }[] }).__frames)
      const released = frames.findIndex((frame) => !frame.placeholder)
      if (reducedMotion === 'reduce') {
        // Displayed and released in one step: no transition, no placeholder, full opacity.
        expect(frames.filter((frame) => frame.transition || frame.placeholder || frame.opacity !== '1')).toEqual([])
      } else {
        expect(frames[0]!.transition).toBe('opacity 400ms ease-out')
        expect(frames.slice(0, released).some((frame) => Number(frame.opacity) < 1)).toBe(true)
        // The placeholder goes when the fade ends.
        expect(frames[released]!.time - frames[0]!.time).toBeGreaterThanOrEqual(350)
        // The 400 ms timer can fire a frame before the animation clock reaches the end: the release frame may show the last 1 %.
        expect(frames[released]!.transition).toBe('')
        expect(Number(frames[released]!.opacity)).toBeGreaterThanOrEqual(0.99)
      }
    })
  })
}
