import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createImageApp, createPlaceholder, svgToDataUri } from '@lazy-ease/server'
import { Hono, type MiddlewareHandler } from 'hono'
import sharp from 'sharp'
import { ensureDemoImages } from './scripts/generate-images.js'
import { profileFromQuery } from './src/throttle.js'

const PORT = 3001
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'images')

await ensureDemoImages(root)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Simulates a slow network for the demo: waits `latency` ms, then streams the
 * body in small chunks at the given bandwidth so images arrive progressively.
 */
const throttle: MiddlewareHandler = async (c, next) => {
  const profile = profileFromQuery(c.req.query())
  if (!profile) return next()

  await sleep(profile.latency)
  await next()

  const ticksPerSecond = 20
  const bytesPerTick = Math.max(1, Math.round((profile.kbps * 1000) / 8 / ticksPerSecond))
  const body = new Uint8Array(await c.res.arrayBuffer())
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= body.length) return controller.close()
      await sleep(1000 / ticksPerSecond)
      controller.enqueue(body.subarray(offset, (offset += bytesPerTick)))
    },
  })
  const { status, headers } = c.res
  c.res = undefined
  c.res = new Response(stream, { status, headers })
}

const app = new Hono()

app.use('/_img/image', throttle)
app.route('/_img', createImageApp({ root }))

// Stands in for a CMS or build step: the image list ships with inline
// placeholders, so they render on first paint without any request.
let imageList: Promise<unknown[]> | undefined
async function listImages() {
  const files = (await readdir(root)).filter((file) => /\.(jpe?g|png|webp|avif)$/i.test(file)).sort()
  return Promise.all(
    files.map(async (file) => {
      const input = path.join(root, file)
      const { width = 1, height = 1 } = await sharp(input).metadata()
      const [blur, color] = await Promise.all([
        createPlaceholder(input, { mode: 'blur' }),
        createPlaceholder(input, { mode: 'color' }),
      ])
      return { src: `/${file}`, width, height, placeholders: { blur: svgToDataUri(blur), color: svgToDataUri(color) } }
    }),
  )
}

app.get('/api/images', async (c) => c.json(await (imageList ??= listImages())))

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Image server on http://localhost:${PORT}`)
})
