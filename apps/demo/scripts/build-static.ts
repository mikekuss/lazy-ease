import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// `render` is the same pipeline the image route runs.
import { computeMetadata, render } from '@lazy-ease/server'
import { LOGO, WAVE } from '../src/catalog.js'
import { EXTERNAL_FILE, staticVariantSets } from '../src/plan.js'
import { STATIC_FORMATS, STATIC_QUALITIES, variantFile, type StaticFormat } from '../src/staticLoader.js'
import { ensureDemoImages } from './generate-images.js'

// Second half of `pnpm --filter demo build:static`, after `vite build --mode
// static`: writes everything the demo server would serve into dist/ as plain
// files, so GitHub Pages can host it, then checks that every image URL in the
// prerendered pages names one of those files.
//
//   dist/api/images.json            the image list with metadata (/api/images)
//   dist/_img/{src}/{variant}       every variant the static loader can request
//   dist/_img/extra/{svg,gif}       originals, served as they are
//   dist/external/{file}            the original for the external-image case

const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.join(demoDir, 'images')
const out = path.join(demoDir, 'dist')
const BASE = '/lazy-ease/'

if (!(await stat(path.join(out, 'index.html')).catch(() => undefined))) {
  throw new Error('dist/index.html is missing; run `vite build --mode static` first')
}
const drawn = await ensureDemoImages(root)
// A deploy should show the photos; say so loudly when some are drawn stand-ins.
if (drawn.length > 0) {
  const message = `Static demo built with drawn stand-ins instead of photos: ${drawn.join(', ')}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
}

// The same list /api/images serves: root images and extra/, private/ left out.
const files = [...(await readdir(root)), ...(await readdir(path.join(root, 'extra'))).map((file) => `extra/${file}`)]
  .filter((file) => /(^|\/)[^./][^/]*\.(jpe?g|png|webp|avif)$/i.test(file))
  .sort()
const images = await Promise.all(
  files.map(async (file) => ({ src: `/${file}`, file, ...(await computeMetadata(path.join(root, file))) })),
)
await mkdir(path.join(out, 'api'), { recursive: true })
await writeFile(path.join(out, 'api', 'images.json'), JSON.stringify(images))

await mkdir(path.join(out, 'external'), { recursive: true })
await copyFile(path.join(root, EXTERNAL_FILE), path.join(out, 'external', EXTERNAL_FILE))
for (const original of [LOGO, WAVE]) {
  await mkdir(path.join(out, '_img', path.dirname(original)), { recursive: true })
  await copyFile(path.join(root, original), path.join(out, '_img', original))
}

interface Task {
  source: string
  target: string
  width: number
  aspectRatio?: number
  focalPoint?: { x: number; y: number }
  quality: number
  format: StaticFormat
}

const gallery = images.filter((image) => !image.file.includes('/'))
// WebP covers native loading and browsers without AVIF.
const tasks: Task[] = staticVariantSets(gallery).flatMap(({ src, aspectRatio, focalPoint, widths }) =>
  widths.flatMap((width) =>
    STATIC_FORMATS.flatMap((format) =>
      STATIC_QUALITIES.map((quality) => ({
        source: path.join(root, src),
        target: path.join(out, '_img', src, variantFile({ width, aspectRatio, focalPoint, quality, format })),
        width,
        aspectRatio,
        focalPoint,
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

// Every image URL the prerendered HTML emits must be a file of the build.
async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '_img' ? [] : htmlFiles(file)
      return entry.name.endsWith('.html') ? [file] : []
    }),
  )
  return nested.flat()
}
const missing: string[] = []
let checked = 0
for (const file of await htmlFiles(out)) {
  const html = await readFile(file, 'utf8')
  const urls = new Set(html.match(new RegExp(`${BASE}_img/[^\\s"',]+`, 'g')) ?? [])
  for (const url of urls) {
    checked++
    const target = path.join(out, decodeURIComponent(url.slice(BASE.length).replace(/[?#].*/, '')))
    if (!(await stat(target).catch(() => undefined))) missing.push(`${path.relative(out, file)}: ${url}`)
  }
}
if (missing.length > 0) throw new Error(`Prerendered image URLs without a file:\n${missing.join('\n')}`)
console.log(`${checked} prerendered image URLs, all present`)

// The LCP and the fade route must offer the same hero candidates (see
// src/prerender.ts); only the attributes that carry them differ. Vite
// reformats the inline <style>, so this reads the markup after it.
function heroOf(file: string, html: string): string {
  const hero = html.match(/<span[^>]*\bdata-hero\b[^>]*>[\s\S]*?<\/picture>/)?.[0]
  if (!hero) throw new Error(`${file}: no hero <span data-hero> … </picture>`)
  return hero
}
function heroLists(file: string, hero: string, attribute: string): string[][] {
  const tags = [...(hero.match(/<source\b[^>]*>/g) ?? []), ...(hero.match(/<img\b[^>]*>/g) ?? [])]
  const lists = tags.map((tag) => {
    const value = tag.match(new RegExp(`\\s${attribute}="([^"]*)"`))?.[1]
    if (!value) throw new Error(`${file}: hero tag without ${attribute}: ${tag}`)
    return value.split(',').map((candidate) => candidate.trim()).filter(Boolean)
  })
  if (lists.length < 2 || lists.some((list) => list.length === 0)) throw new Error(`${file}: hero lists missing or empty`)
  return lists
}
const lcpHtml = await readFile(path.join(out, 'lcp', 'index.html'), 'utf8')
const fadeHtml = await readFile(path.join(out, 'fade', 'index.html'), 'utf8')
const lcpHero = heroOf('lcp/index.html', lcpHtml)
const fadeHero = heroOf('fade/index.html', fadeHtml)
const lcpLists = heroLists('lcp/index.html', lcpHero, 'srcset')
const fadeLists = heroLists('fade/index.html', fadeHero, 'data-le-srcset')
const problems: string[] = []
if (JSON.stringify(lcpLists) !== JSON.stringify(fadeLists)) problems.push('the LCP and fade hero lists differ')
if (!/<img\b[^>]*\sfetchpriority="high"/.test(lcpHero)) problems.push('the LCP hero img has no fetchpriority="high"')
if (/<script\b/i.test(lcpHtml)) problems.push('the LCP page has a <script>')
if (/\brel="?preload\b/i.test(lcpHtml)) problems.push('the LCP page has a preload')
if (/\sfetchpriority=/.test(fadeHero)) problems.push('the fade hero has a fetchpriority')
if (problems.length > 0) throw new Error(`LCP/fade hero check failed:\n${problems.join('\n')}`)
const counts = (lists: string[][]) => lists.reduce((sum, list) => sum + list.length, 0)
console.log(`LCP and fade hero: ${lcpLists.length} lists, ${counts(lcpLists)}+${counts(fadeLists)} candidates, identical`)
