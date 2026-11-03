import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// `render` is the same pipeline the image route runs.
import { computeMetadata, render } from '@lazy-ease/server'
import { EXTERNAL_IMAGE, staticVariantSets } from '../src/plan.js'
import { STATIC_FORMATS, STATIC_QUALITIES, variantFile, type StaticFormat } from '../src/staticLoader.js'
import { ensureDemoImages } from './generate-images.js'

// Second half of `pnpm --filter demo build:static`, after `vite build --mode
// static`: writes everything the demo server would serve into dist/ as plain
// files, so GitHub Pages can host it.
//
//   dist/api/images.json            the image list with metadata (/api/images)
//   dist/_img/{src}/{variant}       every variant the static loader can request
//   dist/external/{file}            the original for the external-image section

const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.join(demoDir, 'images')
const out = path.join(demoDir, 'dist')

if (!(await stat(path.join(out, 'index.html')).catch(() => undefined))) {
  throw new Error('dist/index.html is missing; run `vite build --mode static` first')
}
await ensureDemoImages(root)

const files = (await readdir(root)).filter((file) => /\.(jpe?g|png|webp|avif)$/i.test(file)).sort()
const images = await Promise.all(
  files.map(async (file) => ({ src: `/${file}`, file, ...(await computeMetadata(path.join(root, file))) })),
)
await mkdir(path.join(out, 'api'), { recursive: true })
await writeFile(path.join(out, 'api', 'images.json'), JSON.stringify(images))

const external = images[EXTERNAL_IMAGE]!.file
await mkdir(path.join(out, 'external'), { recursive: true })
await copyFile(path.join(root, external), path.join(out, 'external', external))

interface Task {
  source: string
  target: string
  width: number
  aspectRatio: number
  quality: number
  format: StaticFormat
}

// WebP covers classic mode (native loading) and browsers without AVIF.
const tasks: Task[] = staticVariantSets(images).flatMap(({ src, aspectRatio, widths }) =>
  widths.flatMap((width) =>
    STATIC_FORMATS.flatMap((format) =>
      STATIC_QUALITIES.map((quality) => ({
        source: path.join(root, src),
        target: path.join(out, '_img', src, variantFile({ width, aspectRatio, quality, format })),
        width,
        aspectRatio,
        quality,
        format,
      })),
    ),
  ),
)

console.log(`Rendering ${tasks.length} variants …`)
const started = performance.now()
let bytes = 0
let next = 0
// sharp is multithreaded per image as well; a few renders at once keep the CPU busy.
const workers = Array.from({ length: Math.max(2, Math.min(8, os.availableParallelism())) }, async () => {
  while (next < tasks.length) {
    const { source, target, ...params } = tasks[next++]!
    const { body } = await render(source, params, { timeout: 120_000 })
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
    bytes += body.length
  }
})
await Promise.all(workers)

const seconds = ((performance.now() - started) / 1000).toFixed(0)
console.log(`${tasks.length} variants, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${seconds} s`)
