import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createImageApp } from '../src/index.js'

let dir: string
let root: string
let app: ReturnType<typeof createImageApp>

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lazy-ease-'))
  root = path.join(dir, 'images')
  await mkdir(root)
  const image = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#3a7' } }).jpeg().toBuffer()
  await writeFile(path.join(root, 'big.jpg'), await image(2000, 1000))
  await writeFile(path.join(root, 'small.jpg'), await image(300, 200))
  await writeFile(path.join(dir, 'secret.jpg'), await image(10, 10))
  app = createImageApp({ root })
})

afterAll(() => rm(dir, { recursive: true, force: true }))

async function size(response: Response) {
  const { width, height, format } = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
  return { width, height, format }
}

describe('/image', () => {
  it('resizes, crops and negotiates the format', async () => {
    const response = await app.request('/image?src=/big.jpg&w=640&h=640', {
      headers: { accept: 'image/avif,image/webp,*/*' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('vary')).toBe('Accept')
    expect(await size(response)).toEqual({ width: 640, height: 640, format: 'webp' })
  })

  it('snaps the width and keeps the requested ratio', async () => {
    const response = await app.request('/image?src=/big.jpg&w=500&h=250&fmt=jpeg')
    expect(await size(response)).toEqual({ width: 640, height: 320, format: 'jpeg' })
  })

  it('does not upscale but keeps the aspect ratio', async () => {
    const response = await app.request('/image?src=/small.jpg&w=1080&h=1080&fmt=png')
    expect(await size(response)).toEqual({ width: 200, height: 200, format: 'png' })
  })

  it('falls back to jpeg', async () => {
    const response = await app.request('/image?src=/big.jpg&w=64')
    expect(response.headers.get('content-type')).toBe('image/jpeg')
  })

  it.each([
    ['/image?src=/../secret.jpg&w=64', 404],
    ['/image?src=..%2F..%2Fsecret.jpg&w=64', 404],
    ['/image?src=https://example.com/a.jpg&w=64', 400],
    ['/image?src=/big.txt&w=64', 400],
    ['/image?src=/missing.jpg&w=64', 404],
    ['/image?src=/big.jpg', 400],
    ['/image?src=/big.jpg&w=-1', 400],
    ['/image?src=/big.jpg&w=64&fmt=gif', 400],
  ])('rejects %s', async (url, status) => {
    expect((await app.request(url)).status).toBe(status)
  })
})

describe('/placeholder', () => {
  it('returns a small svg', async () => {
    const response = await app.request('/placeholder?src=/big.jpg&ar=1')
    const svg = await response.text()
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(svg).toContain('viewBox="0 0 16 16"')
    expect(svg.length).toBeLessThan(1500)
  })

  it('supports a single-color placeholder', async () => {
    const svg = await (await app.request('/placeholder?src=/big.jpg&mode=color')).text()
    expect(svg).toMatch(/fill="rgb\(\d+,\d+,\d+\)"/)
    expect(svg).toContain('viewBox="0 0 1 1"')
  })
})

describe('/meta', () => {
  it('returns size and an inline placeholder', async () => {
    const meta = await (await app.request('/meta?src=/big.jpg')).json()
    expect(meta).toMatchObject({ width: 2000, height: 1000 })
    expect(meta.placeholder).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})
