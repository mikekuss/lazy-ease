import { expect, test } from '@playwright/test'
import { averageColor, boxStyle, pageData, trackImageRequests } from './helpers.js'

// Spec 1 goal 4 and 8: the placeholder is an inline style in the server HTML.
test('the server HTML carries the placeholder inline', async ({ request }) => {
  const html = await (await request.get('/placeholder')).text()
  const { photo } = pageData(html).images

  expect(boxStyle(html, 'ph-color')).toContain('background-color:#5b6c8f')
  expect(boxStyle(html, 'ph-default')).toContain('background-color:#e5e7eb')
  // ThumbHash: only the average color on the server, no data URI.
  const thumbhash = boxStyle(html, 'ph-thumbhash')
  expect(thumbhash).toContain(`background-color:${averageColor(photo.thumbhash).hex}`)
  expect(thumbhash).not.toContain('background-image')
})

test('the first paint shows the placeholder without any request', async ({ page, request }) => {
  const { photo } = pageData(await (await request.get('/placeholder')).text()).images
  const requests: string[] = []
  page.on('request', (r) => requests.push(new URL(r.url()).pathname))
  const images = trackImageRequests(page)
  // No hydration: what the browser paints from the HTML alone.
  await page.route('**/client.js', (route) => route.abort())

  await page.goto('/placeholder', { waitUntil: 'load' })
  const background = (className: string) =>
    page.locator(`.${className}`).evaluate((box) => getComputedStyle(box).backgroundColor)
  expect(await background('ph-color')).toBe('rgb(91, 108, 143)')
  expect(await background('ph-default')).toBe('rgb(229, 231, 235)')
  expect(await background('ph-thumbhash')).toBe(averageColor(photo.thumbhash).rgb)
  expect(images).toEqual([])
  expect(requests).toEqual(['/placeholder', '/client.js'])
})
