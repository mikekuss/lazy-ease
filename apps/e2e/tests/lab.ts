import { test as base, expect, type Page, type Response } from '@playwright/test'
import sharp from 'sharp'

// Lab pages for the conformance specs: each test stores its own HTML on the
// fixture server and opens it from there, without page.route, so the HTTP
// cache stays on. Every request of the test's page carries an `x-e2e-run`
// header, and the server lists what reached it under that run: request
// counts come from the server, not from browser events.

export const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

export interface Hit {
  url: string
  status: number
}

export interface Decoded {
  url: string
  /** Pixels of the bytes the browser received, decoded in Node. */
  width: number
  height: number
  format: string | undefined
  pages: number
  bytes: number
}

interface Lab {
  /** Stores `html` and opens it, waiting for `load` unless `waitUntil` says otherwise. */
  open(html: string, options?: { waitUntil?: 'commit' | 'domcontentloaded' | 'load'; page?: Page }): Promise<string>
  /** What reached the server for this test's page so far, in order. */
  hits(): Promise<Hit[]>
  /** `/_img` requests that reached the server, as path + query. */
  imageHits(): Promise<string[]>
  /** Image responses the browser received, decoded independently of their URL. */
  decoded(): Promise<Decoded[]>
  /** The header to give another context, so its requests count for this test. */
  header: Record<string, string>
}

export const test = base.extend<{ lab: Lab }>({
  lab: async ({ page, baseURL }, use, info) => {
    const run = `${info.testId}-${info.repeatEachIndex}-${info.retry}`
    const header = { 'x-e2e-run': run }
    await page.setExtraHTTPHeaders(header)
    const responses: Promise<Decoded | undefined>[] = []
    const record = (response: Response) => {
      if (!new URL(response.url()).pathname.startsWith('/_img/') || response.status() !== 200) return
      responses.push(
        response.body().then(
          async (body) => {
            const meta = await sharp(body, { animated: true }).metadata()
            return {
              url: new URL(response.url()).pathname + new URL(response.url()).search,
              width: meta.width!,
              height: meta.pageHeight ?? meta.height!,
              format: meta.format,
              pages: meta.pages ?? 1,
              bytes: body.length,
            }
          },
          // A body the engine no longer holds (e.g. an aborted upgrade).
          () => undefined,
        ),
      )
    }
    page.on('response', record)
    let count = 0
    const hits = async () => (await (await fetch(`${baseURL}/_e2e/log/${encodeURIComponent(run)}`)).json()) as Hit[]
    await use({
      header,
      async open(html, { waitUntil = 'load', page: target = page } = {}) {
        const id = `${encodeURIComponent(run)}-${count++}`
        const stored = await fetch(`${baseURL}/_e2e/lab/${id}`, { method: 'PUT', body: html })
        expect(stored.status).toBe(204)
        await target.goto(`/lab/${id}`, { waitUntil })
        return `/lab/${id}`
      },
      hits,
      imageHits: async () => (await hits()).filter((hit) => hit.url.startsWith('/_img/')).map((hit) => hit.url),
      decoded: async () => (await Promise.all(responses)).filter((entry) => entry !== undefined),
    })
  },
})

export { expect }

/** A lab document: the stylesheet, the self-starting script unless replaced, and `body`, opted in to its scan unless `auto` is false. */
export function doc(
  body: string,
  { head = '', script = '<script defer src="/assets/lazy-ease.min.js" data-base-url="/_img" data-formats="webp"></script>', auto = true } = {},
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lab</title>
<link rel="stylesheet" href="/assets/lazy-ease.css">
${script}
<style>body { margin: 0; font: 14px/1.4 sans-serif } .card { width: 320px; margin: 16px } .spacer { height: 1600px }</style>
${head}
</head>
<body${auto ? ' data-le-auto' : ''}>
${body}
</body>
</html>`
}

/** HTML-escapes an attribute value. */
const attr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

export const img = (file: string, w: number, extra = '') => `/_img/${file}?${extra}fmt=webp&q=75&w=${w}`

/** A boxed deferred image: a 3:2 box with a color placeholder and the inert img. */
export function deferred(
  id: string,
  attributes: Record<string, string>,
  { box = 'width:320px;aspect-ratio:3/2', color = 'rgb(187, 200, 207)', alt = id } = {},
): string {
  const data = Object.entries(attributes)
    .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${attr(value)}"`))
    .join('')
  return `<span data-le id="${id}" style="${box};background-color:${color}"><img alt="${alt}" width="1200" height="800" src="${INERT}"${data}></span>`
}

/** Waits until the box `id` reports `loaded` and its image is fully opaque. */
export async function shown(page: Page, id: string, timeout = 20_000): Promise<void> {
  await expect(page.locator(`#${id}`)).toHaveAttribute('data-state', 'loaded', { timeout })
  await expect.poll(() => page.locator(`#${id} img`).evaluate((element) => getComputedStyle(element).opacity), { timeout }).toBe('1')
}

export const currentSrc = (page: Page, id: string) =>
  page.locator(`#${id} img`).evaluate((element: HTMLImageElement) => {
    // Empty while an engine switches sources.
    if (!element.currentSrc) return ''
    const url = new URL(element.currentSrc)
    return url.protocol === 'data:' ? element.currentSrc : url.pathname + url.search
  })

/** The `w` query parameter of a URL. */
export const widthOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('w'))

/** The color of one CSS pixel of the page as painted, as `rgb(r, g, b)`. */
export async function pixel(page: Page, x: number, y: number): Promise<string> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css', animations: 'allow' })
  const { data } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return `rgb(${data[0]}, ${data[1]}, ${data[2]})`
}

/** Whether two `rgb()` colors are within `tolerance` per channel (encoders and color management differ). */
export function near(a: string, b: string, tolerance = 6): boolean {
  const channels = (color: string) => color.match(/\d+/g)!.map(Number)
  const [x, y] = [channels(a), channels(b)]
  return x.slice(0, 3).every((value, i) => Math.abs(value - y[i]!) <= tolerance)
}

export interface Source {
  src: string
  width: number
  height: number
  revision: string
}

/** The fixture server's metadata of the generated sources, from computeMetadata. */
export async function fixtureImages(baseURL: string): Promise<{ photo: Source; small: Source; copy1: Source; copy2: Source; copy3: Source }> {
  const images = (await (await fetch(`${baseURL}/_e2e/images`)).json()) as { photo: Source; small: Source; copies: Source[] }
  const [copy1, copy2, copy3] = images.copies as [Source, Source, Source]
  return { photo: images.photo, small: images.small, copy1, copy2, copy3 }
}
