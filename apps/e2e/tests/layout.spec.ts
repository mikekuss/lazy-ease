import { currentSrc, deferred, doc, expect, img, INERT, shown, test, widthOf } from './lab.js'

// Layout: scroll containers, shadow trees, several bundles on one page,
// device pixel ratios, resizes, upgrades and breakpoint sources. Requested
// variants are counted at the server and checked against the pixels the
// browser actually received.

const MODULE = (code: string) => `<script type="module">${code}</script>`

test('a nested scroller: an image loads once it scrolls into the scroller, with the scroller as root or the viewport', async ({ page, lab }) => {
  const scroller = (id: string, image: string) =>
    `<div id="${id}" style="width:340px;height:240px;overflow:auto"><div style="height:1200px"></div>${image}</div>`
  await lab.open(
    doc(
      `${scroller('own-root', deferred('inner', { 'data-le-url': img('copy-1.jpg', 640) }))}
${scroller('viewport-root', deferred('clipped', { 'data-le-url': img('copy-2.jpg', 640) }))}`,
      {
        auto: false,
        script: MODULE(`import { createLazyEase, enhance } from '/assets/vanilla.js'
const own = document.getElementById('own-root')
enhance(createLazyEase({ root: own, rootMargin: '0px' }), own)
enhance(createLazyEase({ rootMargin: '0px' }), document.getElementById('viewport-root'))`),
      },
    ),
  )
  await page.waitForTimeout(600)
  // Both boxes are inside the viewport's margin, but clipped by their scroller.
  expect(await lab.imageHits()).toEqual([])
  for (const id of ['inner', 'clipped']) await expect(page.locator(`#${id}`)).toHaveAttribute('data-state', 'idle')
  await page.locator('#own-root').evaluate((element) => (element.scrollTop = 1200))
  await shown(page, 'inner')
  expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640)])
  await page.locator('#viewport-root').evaluate((element) => (element.scrollTop = 1200))
  await shown(page, 'clipped')
  expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640), img('copy-2.jpg', 640)])
})

test('shadow roots: the document scan does not enter them, enhancing the shadow root does', async ({ page, lab }) => {
  await lab.open(
    doc(
      `<div class="card">${deferred('light', { 'data-le-url': img('copy-1.jpg', 640) })}</div>
<div class="card" id="host"></div>`,
      {
        head: `<script>
document.addEventListener('DOMContentLoaded', () => {
  const shadow = document.getElementById('host').attachShadow({ mode: 'open' })
  shadow.innerHTML = '<link rel="stylesheet" href="/assets/lazy-ease.css">' + document.getElementById('shadow-markup').innerHTML
}, { once: true })
</script>`,
      },
    ).replace('</body>', `<template id="shadow-markup">${deferred('shadowed', { 'data-le-url': img('copy-2.jpg', 640) })}</template>\n</body>`),
  )
  const shadowBox = page.locator('#host #shadowed')
  await shown(page, 'light')
  await page.waitForTimeout(400)
  await expect(shadowBox).not.toHaveAttribute('data-state', /./)
  await expect(shadowBox.locator('img')).toHaveAttribute('src', INERT)
  expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640)])

  await page.evaluate(async () => {
    const { createLazyEase, enhance } = (await import('/assets/vanilla.js' as string)) as typeof import('@lazy-ease/vanilla') & typeof import('@lazy-ease/core')
    enhance(createLazyEase(), document.getElementById('host')!.shadowRoot!)
  })
  await expect(shadowBox).toHaveAttribute('data-state', 'loaded')
  await expect.poll(() => shadowBox.locator('img').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  // The shadow stylesheet applies: the box is a block and the img covers it.
  expect(await shadowBox.evaluate((element) => [getComputedStyle(element).display, Math.round(element.querySelector('img')!.getBoundingClientRect().height)])).toEqual(['block', 213])
  expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640), img('copy-2.jpg', 640)])
})

for (const order of ['IIFE first', 'module first'] as const) {
  test(`two bundles on one page (${order}) attach every image once`, async ({ page, lab }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    const iife = '<script defer src="/assets/lazy-ease.min.js" data-base-url="/_img" data-formats="webp"></script>'
    // The module is a separate bundle with its own copy of core, and asks for q=60: a double attach shows as two URLs.
    const esm = MODULE(`import { createLazyEase, createLoader, enhance } from '/assets/vanilla.js'
enhance(createLazyEase({ quality: 60, loader: createLoader({ baseUrl: '/_img', formats: ['webp'], qualities: [60, 75] }) }), document)`)
    await lab.open(
      doc(
        `<div class="card">${deferred('prepared', { 'data-le-url': img('copy-1.jpg', 640) })}</div>
<div class="card">${deferred('measured', { 'data-le-src': '/copy-2.jpg', 'data-le-ar': '1.5', 'data-le-srcw': '1200', 'data-le-srch': '800' })}</div>
<div class="card"><span data-le-background id="banner" style="display:block;aspect-ratio:4"></span></div>`,
        { script: order === 'IIFE first' ? iife + esm : esm + iife },
      ),
    )
    for (const id of ['prepared', 'measured']) await shown(page, id)
    await expect(page.locator('#banner')).toHaveAttribute('data-le-visible', '')
    const hits = await lab.imageHits()
    // The prepared URL is the same for both bundles; the measured one says which bundle built it.
    const measured = img('copy-2.jpg', 384, 'ar=1.5&')
    expect(hits.filter((hit) => hit.startsWith('/_img/copy-1.jpg'))).toEqual([img('copy-1.jpg', 640)])
    const built = hits.filter((hit) => hit.startsWith('/_img/copy-2.jpg'))
    expect(built).toHaveLength(1)
    expect([measured, measured.replace('q=75', 'q=60')]).toContain(built[0])
    expect(hits).toHaveLength(2)
    expect(errors).toEqual([])
  })
}

for (const dpr of [1, 2, 3]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr })

    test('a measured image requests one variant whose pixels match the slot', async ({ page, lab }) => {
      await lab.open(doc(`<div class="card">${deferred('measured', { 'data-le-src': '/photo.jpg', 'data-le-ar': '1.5', 'data-le-srcw': '2400', 'data-le-srch': '1600' })}</div>`))
      await shown(page, 'measured')
      // 320 px slot: candidates stop at snap(2 × 320) = 640; the browser takes snap(320 × DPR).
      const expected = [384, 640, 640][dpr - 1]!
      expect(await lab.imageHits()).toEqual([img('photo.jpg', expected, 'ar=1.5&')])
      const [received] = await lab.decoded()
      expect(received).toMatchObject({ width: expected, height: Math.round(expected / 1.5), format: 'webp' })
      expect(await page.locator('#measured img').evaluate((element: HTMLImageElement) => [element.width, element.height])).toEqual([320, 213])
    })
  })
}

test.describe('resizes', () => {
  test.use({ viewport: { width: 500, height: 700 } })
  const fluid = deferred('fluid', { 'data-le-src': '/photo.jpg', 'data-le-ar': '1.5', 'data-le-srcw': '2400', 'data-le-srch': '1600' }, { box: 'width:auto;aspect-ratio:3/2' })

  test('a height-only resize requests nothing; a wider viewport upgrades once', async ({ page, lab }) => {
    await lab.open(doc(fluid))
    await shown(page, 'fluid')
    await expect(page.locator('#fluid img')).toHaveAttribute('sizes', '500px')
    for (const height of [400, 900, 700]) {
      await page.setViewportSize({ width: 500, height })
      await page.waitForTimeout(400)
    }
    await expect(page.locator('#fluid img')).toHaveAttribute('sizes', '500px')
    expect(await lab.imageHits()).toEqual([img('photo.jpg', 640, 'ar=1.5&')])
    await page.setViewportSize({ width: 900, height: 700 })
    await expect(page.locator('#fluid img')).toHaveAttribute('sizes', '900px')
    await expect.poll(() => lab.imageHits()).toEqual([img('photo.jpg', 640, 'ar=1.5&'), img('photo.jpg', 1080, 'ar=1.5&')])
    await expect.poll(() => currentSrc(page, 'fluid')).toBe(img('photo.jpg', 1080, 'ar=1.5&'))
    expect((await lab.decoded()).map(({ width, height }) => [width, height])).toEqual([
      [640, 427],
      [1080, 720],
    ])
  })

  test('an upgrade keeps the displayed image, and a failed upgrade keeps it too', async ({ page, context, baseURL, lab }) => {
    await page.addInitScript(() => {
      const frames: { state: string | null; opacity: string; background: string; src: string }[] = []
      ;(window as unknown as { __frames: typeof frames }).__frames = frames
      let displayed = false
      const sample = () => {
        const box = document.getElementById('fluid')
        const element = box?.querySelector('img')
        // Every frame from the first display on, so a state flicker shows too.
        displayed ||= box?.getAttribute('data-state') === 'loaded'
        if (displayed && box && element)
          frames.push({ state: box.getAttribute('data-state'), opacity: getComputedStyle(element).opacity, background: box.style.backgroundColor, src: element.currentSrc })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await lab.open(doc(fluid))
    await shown(page, 'fluid')
    const first = img('photo.jpg', 640, 'ar=1.5&')
    await page.evaluate(() => ((window as unknown as { __frames: unknown[] }).__frames.length = 0))

    // The upgrade streams over 1.5 s; the 640w image stays on screen meanwhile.
    await context.addCookies([{ name: 'e2e-throttle', value: '0:1500', url: baseURL! }])
    await page.setViewportSize({ width: 900, height: 700 })
    await expect.poll(() => currentSrc(page, 'fluid'), { timeout: 15_000 }).toBe(img('photo.jpg', 1080, 'ar=1.5&'))
    // Engines switch currentSrc while the upgrade still streams; its load event comes at the end.
    await expect.poll(() => page.locator('#fluid img').evaluate((element: HTMLImageElement) => element.complete), { timeout: 15_000 }).toBe(true)
    let frames = await page.evaluate(() => (window as unknown as { __frames: { state: string; opacity: string; background: string; src: string }[] }).__frames)
    const during = frames.filter((frame) => frame.src.endsWith(first))
    expect(during.length).toBeGreaterThan(5)
    expect(frames.filter((frame) => frame.opacity !== '1' || frame.state !== 'loaded' || frame.background !== '')).toEqual([])

    // A failed upgrade restores the attributes that displayed the image.
    await context.clearCookies()
    await page.route('**/_img/photo.jpg?*w=1440', (route) => route.abort())
    const failed = page.waitForEvent('requestfailed', (request) => request.url().endsWith('w=1440'))
    await page.setViewportSize({ width: 1280, height: 700 })
    await failed
    // Back to the attributes that displayed 1080w: the 900px slot and its list.
    await expect(page.locator('#fluid img')).toHaveAttribute('sizes', '900px')
    await expect.poll(() => currentSrc(page, 'fluid')).toBe(img('photo.jpg', 1080, 'ar=1.5&'))
    await expect(page.locator('#fluid')).toHaveAttribute('data-state', 'loaded')
    frames = await page.evaluate(() => (window as unknown as { __frames: { state: string; opacity: string; background: string; src: string }[] }).__frames)
    expect(frames.length).toBeGreaterThan(during.length)
    expect(frames.filter((frame) => frame.opacity !== '1' || frame.state !== 'loaded' || frame.background !== '')).toEqual([])
  })
})

test('breakpoint sources: the browser switches between the prepared picture sources and keeps the image displayed', async ({ page, lab }) => {
  const list = (file: string, ratio: number) => [640, 1080].map((w) => `${img(file, w, `ar=${ratio}&`)} ${w}w`).join(', ')
  await lab.open(
    doc(
      `<style>#hero { --ar: 1; aspect-ratio: var(--ar); width: 320px; background-color: #bbc8cf } @media (min-width: 800px) { #hero { --ar: 2 } }</style>
<div class="card"><span data-le id="hero"><picture>
<source media="(min-width:800px)" data-le-srcset="${list('copy-1.jpg', 2)}" data-le-sizes="320px">
<img alt="hero" width="1200" height="1200" src="${INERT}" data-le-srcset="${list('copy-2.jpg', 1)}" data-le-sizes="320px">
</picture></span></div>`,
    ),
  )
  await shown(page, 'hero')
  expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640, 'ar=2&')])
  await page.setViewportSize({ width: 600, height: 720 })
  await expect.poll(() => currentSrc(page, 'hero')).toBe(img('copy-2.jpg', 640, 'ar=1&'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect.poll(() => currentSrc(page, 'hero')).toBe(img('copy-1.jpg', 640, 'ar=2&'))
  await expect(page.locator('#hero')).toHaveAttribute('data-state', 'loaded')
  const decoded = await lab.decoded()
  expect(decoded.map(({ url, width, height }) => [widthOf(url), width, height])).toEqual([
    [640, 640, 320],
    [640, 640, 640],
  ])
  // Back at the wide breakpoint the cached wide image is reused.
  expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640, 'ar=2&'), img('copy-2.jpg', 640, 'ar=1&')])
})
