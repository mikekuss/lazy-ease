import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// Procedural landscapes so the demo works without shipping photos. The noise
// layer keeps the JPEGs at realistic file sizes; flat gradients compress to
// almost nothing and would load too fast to see anything.
interface Scene {
  name: string
  width: number
  height: number
  hue: number
  night?: boolean
}

const SCENES: Scene[] = [
  { name: 'alpine-dawn', width: 3000, height: 2000, hue: 20 },
  { name: 'blue-ridge', width: 3000, height: 2000, hue: 210 },
  { name: 'desert-dusk', width: 3360, height: 1440, hue: 32 },
  { name: 'northern-night', width: 3000, height: 2000, hue: 160, night: true },
  { name: 'misty-pines', width: 1600, height: 2400, hue: 140 },
  { name: 'violet-peaks', width: 2400, height: 2400, hue: 275 },
  { name: 'glacier-noon', width: 3000, height: 2000, hue: 190 },
  { name: 'ember-canyon', width: 1600, height: 2400, hue: 8 },
  { name: 'starfield', width: 3360, height: 1440, hue: 235, night: true },
  { name: 'meadow-haze', width: 2400, height: 2400, hue: 95 },
]

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ridge(rand: () => number, width: number, height: number, base: number, roughness: number) {
  const steps = 48
  let y = base
  const points = [`M0,${height}`]
  for (let i = 0; i <= steps; i++) {
    y = Math.min(height, Math.max(height * 0.15, y + (rand() - 0.5) * roughness))
    points.push(`L${((i / steps) * width).toFixed(0)},${y.toFixed(0)}`)
  }
  points.push(`L${width},${height}Z`)
  return points.join(' ')
}

function svg({ width, height, hue, night }: Scene, seed: number): string {
  const rand = random(seed)
  const sky = night
    ? [`hsl(${hue} 60% 6%)`, `hsl(${hue} 55% 22%)`]
    : [`hsl(${hue + 190} 55% 55%)`, `hsl(${hue} 85% 72%)`]
  const sunX = width * (0.2 + rand() * 0.6)
  const sunY = height * (0.2 + rand() * 0.2)
  const stars = night
    ? Array.from({ length: 400 }, () =>
        `<circle cx="${(rand() * width).toFixed(0)}" cy="${(rand() * height * 0.7).toFixed(0)}" r="${(rand() * 2.5 + 0.5).toFixed(1)}" fill="#fff" opacity="${(rand() * 0.8 + 0.2).toFixed(2)}"/>`,
      ).join('')
    : ''
  const layers = [0.45, 0.58, 0.7, 0.82]
    .map((level, i) => {
      const lightness = night ? 14 - i * 3 : 52 - i * 11
      const d = ridge(rand, width, height, height * level, height * (0.12 - i * 0.02))
      return `<path d="${d}" fill="hsl(${hue + 200 + i * 8} 35% ${lightness}%)"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/>
      </linearGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="#fff8e0"/><stop offset="1" stop-color="#fff8e0" stop-opacity="0"/></radialGradient>
      <filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="8" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0.4"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#sky)"/>
    ${stars}
    <circle cx="${sunX}" cy="${sunY}" r="${Math.min(width, height) * (night ? 0.06 : 0.18)}" fill="url(#sun)"/>
    ${layers}
    <rect width="100%" height="100%" filter="url(#noise)" opacity="0.45"/>
  </svg>`
}

/**
 * Random gray noise at a quarter of the resolution, scaled up. Features a few
 * pixels wide survive downscaling, like foliage or rock texture in a photo.
 */
function detail({ width, height }: Scene, seed: number): Promise<Buffer> {
  const rand = random(seed * 7919)
  const w = Math.round(width / 4)
  const h = Math.round(height / 4)
  const pixels = Buffer.alloc(w * h)
  for (let i = 0; i < pixels.length; i++) pixels[i] = 128 + Math.round((rand() - 0.5) * 90)
  return sharp(pixels, { raw: { width: w, height: h, channels: 1 } })
    .resize(width, height, { kernel: 'cubic' })
    .png()
    .toBuffer()
}

/** Renders the demo images into `dir` unless it already contains images. */
export async function ensureDemoImages(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const existing = (await readdir(dir)).filter((file) => /\.(jpe?g|png|webp|avif)$/i.test(file))
  if (existing.length > 0) return

  console.log(`Generating ${SCENES.length} demo images in ${dir} …`)
  for (const [index, scene] of SCENES.entries()) {
    const base = await sharp(Buffer.from(svg(scene, index + 1))).png().toBuffer()
    await sharp(base)
      .composite([{ input: await detail(scene, index + 1), blend: 'overlay' }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(path.join(dir, `${scene.name}.jpg`))
    console.log(`  ${scene.name}.jpg`)
  }
}
