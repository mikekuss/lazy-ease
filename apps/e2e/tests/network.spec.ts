import { currentSrc, deferred, doc, expect, fixtureImages, img, INERT, near, pixel, shown, test } from './lab.js'

// Controlled network: what the page shows at first paint, without or with a
// failed script, when the script starts after an image completed, when
// decoding is slow, in which order sources are written, and what the HTTP
// cache saves. Request counts come from the fixture server.

const PLACEHOLDER = 'rgb(187, 200, 207)'
const native = (id: string, src: string, extra = '') =>
  `<span data-le id="${id}" style="width:320px;aspect-ratio:3/2;background-color:${PLACEHOLDER}"><img alt="${id}" width="1200" height="800" src="${src}"${extra}></span>`

/** A native image above the fold, a deferred one next to it and one far below. */
const page3 = (script?: string) =>
  doc(
    `<div class="card">${native('native', img('copy-1.jpg', 640))}</div>
<div class="card">${deferred('prepared', { 'data-le-url': img('copy-2.jpg', 640) })}</div>
<div class="spacer"></div>
<div class="card">${deferred('below', { 'data-le-url': img('copy-3.jpg', 640) })}</div>`,
    script === undefined ? {} : { script },
  )

const geometry = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ['native', 'prepared', 'below'].map((id) => {
        const rect = document.getElementById(id)!.getBoundingClientRect()
        return [id, [rect.x, rect.y + scrollY, rect.width, rect.height].map(Math.round)]
      }),
    ),
  )

test('first paint: reserved boxes with their placeholder, nothing below the fold requested', async ({ page, context, baseURL, browserName, lab }) => {
  test.slow()
  // Every image response arrives 8 s late, so the page can be inspected before any image.
  await context.addCookies([{ name: 'e2e-throttle', value: '8000:0', url: baseURL! }])
  await lab.open(page3(), { waitUntil: 'commit' })
  // WebKit's goto can return DOMContentLoaded late; wait in the page instead.
  await page.waitForFunction(() => document.readyState !== 'loading' && document.getElementById('prepared')?.hasAttribute('data-state'))
  const first = await geometry(page)
  expect(first.prepared).toEqual([16, first.prepared![1], 320, 213])
  // The deferred box paints its color while its image is on its way: the img
  // is either not activated yet (the inert pixel) or hidden until it has loaded.
  expect(
    await page.locator('#prepared').evaluate((box) => {
      const image = box.querySelector('img')!
      return [box.getAttribute('data-state'), getComputedStyle(box).backgroundColor, image.src.startsWith('data:') || getComputedStyle(image).opacity === '0']
    }),
  ).toEqual([expect.stringMatching(/^(idle|loading)$/), PLACEHOLDER, true])
  // As painted. WebKit's screenshot waits for the pending image loads, so it would show the end state.
  if (browserName !== 'webkit') expect(near(await pixel(page, first.prepared![0]! + 160, first.prepared![1]! + 100), PLACEHOLDER)).toBe(true)
  await shown(page, 'native')
  await shown(page, 'prepared')
  // No layout shift: every box kept the geometry of the first paint.
  expect(await geometry(page)).toEqual(first)
  expect((await lab.imageHits()).sort()).toEqual([img('copy-1.jpg', 640), img('copy-2.jpg', 640)])
})

for (const failure of ['disabled', 'status 500', 'aborted'] as const) {
  test(`without a working script (${failure}) native images load and deferred boxes keep their placeholder`, async ({ browser, page, baseURL, lab }) => {
    const target = failure === 'disabled' ? await (await browser.newContext({ baseURL, javaScriptEnabled: false, extraHTTPHeaders: lab.header })).newPage() : page
    if (failure === 'aborted') await target.route('**/assets/lazy-ease.min.js*', (route) => route.abort())
    const script = failure === 'status 500' ? '<script defer src="/assets/lazy-ease.min.js?status=500" data-base-url="/_img"></script>' : undefined
    await lab.open(page3(script), { page: target })
    await expect.poll(() => target.locator('#native img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(640)
    await target.locator('#below').scrollIntoViewIfNeeded()
    await target.waitForTimeout(500)
    for (const id of ['prepared', 'below']) {
      await expect(target.locator(`#${id} img`)).toHaveAttribute('src', INERT)
      await expect(target.locator(`#${id}`)).not.toHaveAttribute('data-state', /./)
      await expect(target.locator(`#${id}`)).toHaveCSS('background-color', PLACEHOLDER)
    }
    expect(await geometry(target)).toMatchObject({ prepared: [16, expect.any(Number), 320, 213], below: [16, expect.any(Number), 320, 213] })
    expect(await lab.imageHits()).toEqual([img('copy-1.jpg', 640)])
    if (failure === 'disabled') await target.context().close()
  })
}

test('a script that starts after the images completed adopts them without a second request or a fade', async ({ page, lab }) => {
  // Every style, src and srcset write on an img, from the first parse on.
  await page.addInitScript(() => {
    const writes: string[] = []
    ;(window as unknown as { __writes: string[] }).__writes = writes
    new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target as HTMLImageElement
        if (element.tagName === 'IMG') writes.push(`${element.alt} ${record.attributeName}=${element.getAttribute(record.attributeName!)}`)
      }
    }).observe(document, { subtree: true, attributeFilter: ['style', 'src', 'srcset', 'sizes'] })
  })
  const missing = '/_img/missing.jpg?fmt=webp&q=75&w=640'
  await lab.open(
    doc(`<div class="card">${native('done', img('copy-1.jpg', 640))}</div><div class="card">${native('broken', missing)}</div>`, {
      script: '<script defer src="/assets/lazy-ease.min.js?delay=1500" data-base-url="/_img"></script>',
    }),
    { waitUntil: 'commit' },
  )
  // Both images finish before the script arrives.
  await expect.poll(() => page.locator('img').evaluateAll((all: HTMLImageElement[]) => all.map((element) => element.complete))).toEqual([true, true])
  await expect(page.locator('#done')).not.toHaveAttribute('data-state', /./)
  await expect(page.locator('#done')).toHaveAttribute('data-state', 'loaded', { timeout: 10_000 })
  await expect(page.locator('#broken')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('#done img')).toHaveCSS('opacity', '1')
  // Adoption touched no source and never hid the image.
  expect(await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)).toEqual([])
  expect((await lab.imageHits()).sort()).toEqual([img('copy-1.jpg', 640), missing])
})

for (const delay of [120, 3000]) {
  test(`a decode that takes ${delay} ms keeps the image hidden until it ends or the 250 ms timeout`, async ({ page, lab }) => {
    await page.addInitScript((delay) => {
      const decode = HTMLImageElement.prototype.decode
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        return decode.call(this).then(() => new Promise<void>((resolve) => setTimeout(resolve, delay)))
      }
      const marks: Record<string, number> = {}
      const samples: string[] = []
      ;(window as unknown as { __marks: typeof marks; __samples: string[] }).__marks = marks
      ;(window as unknown as { __samples: string[] }).__samples = samples
      document.addEventListener(
        'load',
        (event) => {
          const element = event.target as HTMLImageElement
          if (element.tagName === 'IMG' && !element.currentSrc.startsWith('data:')) marks.load ??= performance.now()
        },
        true,
      )
      new MutationObserver(() => {
        if (document.getElementById('slow')?.getAttribute('data-state') === 'loaded') marks.loaded ??= performance.now()
      }).observe(document, { subtree: true, attributeFilter: ['data-state'] })
      const sample = () => {
        const element = document.querySelector<HTMLImageElement>('#slow img')
        if (marks.load !== undefined && marks.loaded === undefined && element) samples.push(getComputedStyle(element).opacity)
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, delay)
    await lab.open(doc(`<div class="card">${deferred('slow', { 'data-le-url': img('copy-1.jpg', 640) })}</div>`))
    await shown(page, 'slow')
    const { marks, samples } = await page.evaluate(() => {
      const w = window as unknown as { __marks: { load: number; loaded: number }; __samples: string[] }
      return { marks: w.__marks, samples: w.__samples }
    })
    const waited = marks.loaded - marks.load
    if (delay < 250) expect(waited).toBeGreaterThanOrEqual(delay - 10)
    else {
      expect(waited).toBeGreaterThanOrEqual(240)
      expect(waited).toBeLessThan(1500)
    }
    // Hidden the whole time between the load event and the display.
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.filter((opacity) => opacity !== '0')).toEqual([])
  })
}

test('sizes is written before srcset, and only the selected candidate is requested', async ({ page, lab }) => {
  await page.addInitScript(() => {
    const order: string[] = []
    ;(window as unknown as { __order: string[] }).__order = order
    new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target as HTMLElement
        const id = element.closest('[data-le]')?.id
        // Each source on its own: source0, source1.
        const tag = element.tagName === 'SOURCE' ? `source${[...element.parentElement!.children].indexOf(element)}` : element.tagName.toLowerCase()
        if (id && record.attributeName && element.hasAttribute(record.attributeName)) order.push(`${id}:${tag}:${record.attributeName}`)
      }
    }).observe(document, { subtree: true, attributeFilter: ['sizes', 'srcset'] })
  })
  const list = (file: string, extra = '') => [640, 1080, 1920].map((w) => `${img(file, w, extra)} ${w}w`).join(', ')
  await lab.open(
    doc(`<div class="card">${deferred('prepared', { 'data-le-srcset': list('copy-1.jpg'), 'data-le-sizes': '320px', 'data-le-url': img('copy-1.jpg', 1920) })}</div>
<div class="card">${deferred('measured', { 'data-le-src': '/copy-2.jpg', 'data-le-ar': '1.5', 'data-le-srcw': '1200', 'data-le-srch': '800' })}</div>
<div class="card"><span data-le id="picture" style="width:320px;aspect-ratio:3/2;background-color:${PLACEHOLDER}"><picture>
<source media="(min-width:1000px)" data-le-srcset="${list('copy-3.jpg', 'ar=2&')}" data-le-sizes="320px">
<source media="(min-width:600px)" data-le-srcset="${list('photo.jpg', 'ar=1.5&')}" data-le-sizes="320px">
<img alt="picture" width="1200" height="800" src="${INERT}" data-le-srcset="${list('small.jpg')}" data-le-sizes="320px">
</picture></span></div>`),
  )
  for (const id of ['prepared', 'measured', 'picture']) await shown(page, id)
  const order = await page.evaluate(() => (window as unknown as { __order: string[] }).__order)
  for (const element of ['prepared:img', 'measured:img', 'picture:source0', 'picture:source1', 'picture:img']) {
    const writes = order.filter((entry) => entry.startsWith(`${element}:`))
    expect(writes.slice(0, 2), element).toEqual([`${element}:sizes`, `${element}:srcset`])
  }
  // The first matching source wins; at 1280 px and DPR 1 a 320 px slot takes the 640w candidate.
  expect((await lab.imageHits()).sort()).toEqual([img('copy-1.jpg', 640), img('copy-2.jpg', 384, 'ar=1.5&'), img('copy-3.jpg', 640, 'ar=2&')].sort())
  expect(await currentSrc(page, 'picture')).toBe(img('copy-3.jpg', 640, 'ar=2&'))
})

test('the HTTP cache: a versioned URL is not requested again, an unversioned one only revalidates', async ({ page, baseURL, lab }) => {
  const { copy1 } = await fixtureImages(baseURL!)
  expect(copy1.revision).toBeTruthy()
  const versioned = img('copy-1.jpg', 640).replace('&w=', `&v=${copy1.revision}&w=`)
  const plain = img('copy-2.jpg', 640)
  const html = doc(
    ['a', 'b', 'twin'].map((id) => `<div class="card">${deferred(id, { 'data-le-url': id === 'a' ? versioned : plain })}</div>`).join('\n'),
  )
  const responses: Record<string, string | undefined> = {}
  page.on('response', async (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/_img/')) responses[url.pathname + url.search] = (await response.allHeaders())['cache-control']
  })
  const path = await lab.open(html)
  for (const id of ['a', 'b', 'twin']) await shown(page, id)
  expect(responses[versioned]).toBe('public, max-age=31536000, immutable')
  expect(responses[plain]).toBe('public, no-cache')
  // Two images with one URL share one request.
  expect((await lab.hits()).filter((hit) => hit.url.startsWith('/_img/'))).toEqual(
    expect.arrayContaining([
      { url: versioned, status: 200 },
      { url: plain, status: 200 },
    ]),
  )
  expect(await lab.imageHits()).toHaveLength(2)

  // A second visit, as a link would make it.
  await page.goto(`${path}?again`)
  for (const id of ['a', 'b', 'twin']) await shown(page, id)
  const again = (await lab.hits()).filter((hit) => hit.url.startsWith('/_img/')).slice(2)
  expect(again.filter((hit) => hit.url === versioned)).toEqual([])
  // The no-cache URL revalidates once for both of its images.
  expect(again).toEqual([{ url: plain, status: 304 }])
})
