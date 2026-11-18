import { expect, test, type Page } from '@playwright/test'
type Core = typeof import('@lazy-ease/core')

// The core controller driven directly on a blank page (/core), for what jsdom
// cannot show: real load, complete and naturalWidth values.

const INERT = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const url = (n: number) => `/_img/copy-${n}.jpg?fmt=webp&q=75&w=640`

async function open(page: Page) {
  await page.goto('/core')
  await page.waitForFunction(() => 'core' in window)
}

test('a destroyed image attached again with another source starts over from its placeholder', async ({ page }) => {
  await open(page)
  const result = await page.evaluate(
    async ({ INERT, a, b }) => {
      const { createLazyEase } = (window as unknown as { core: Core }).core
      const box = document.createElement('span')
      box.setAttribute('data-le', '')
      box.style.cssText = 'display:block;width:320px;height:213px;background-color:red'
      const img = new Image()
      img.alt = 'Copy'
      img.style.cssText = 'display:block;width:100%;height:100%'
      img.src = INERT
      box.append(img)
      document.body.append(box)
      const le = createLazyEase({ fadeDuration: 0 })
      let first: { destroy(): void } | undefined
      await new Promise((resolve) => (first = le.attach(img, { url: a, loading: 'eager', onDisplay: resolve })))
      first!.destroy()

      const states: string[] = []
      const displayed: string[] = []
      let done!: () => void
      const loaded = new Promise<void>((resolve) => (done = resolve))
      const next = le.attach(img, {
        url: b,
        placeholder: 'blue',
        loading: 'eager',
        onStateChange: (state) => states.push(state),
        onDisplay: () => {
          displayed.push(new URL(img.currentSrc).pathname + new URL(img.currentSrc).search)
          done()
        },
      })
      const atAttach = { states: [...states], displayed: [...displayed], placeholder: box.style.backgroundColor }
      await loaded
      return { atAttach, states, displayed, final: next.state }
    },
    { INERT, a: url(1), b: url(2) },
  )
  // Not the old image adopted at once (loaded, onDisplay for copy-1, placeholder removed).
  expect(result.atAttach).toEqual({ states: ['idle', 'loading'], displayed: [], placeholder: 'blue' })
  expect(result.states).toEqual(['idle', 'loading', 'loaded'])
  expect(result.displayed).toEqual([url(2)])
  expect(result.final).toBe('loaded')
})

test('a loaded native data: URI image is adopted as loaded', async ({ page }) => {
  await open(page)
  const result = await page.evaluate(async () => {
    const { createLazyEase } = (window as unknown as { core: Core }).core
    const img = new Image()
    img.alt = 'Dot'
    img.setAttribute('data-le', '')
    img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>')
    document.body.append(img)
    await img.decode()
    const shown: (Event | undefined)[] = []
    const handle = createLazyEase().attach(img, { loading: 'native', onDisplay: (_, event) => shown.push(event) })
    return { complete: img.complete, naturalWidth: img.naturalWidth, state: handle.state, displays: shown.length, event: shown[0] !== undefined }
  })
  expect(result).toEqual({ complete: true, naturalWidth: 20, state: 'loaded', displays: 1, event: false })
})
