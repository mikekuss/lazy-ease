import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// The demo's originals: photos from picsum.photos (Unsplash license),
// downloaded at the size each case expects, so the repository ships none.
// Without network, a procedural landscape stands in and the next start tries
// the photo again. The noise layer keeps those JPEGs at realistic file sizes;
// flat gradients compress to almost nothing and would load too fast to see
// anything.
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

/** The picsum.photos id of each scene, chosen to match its name and the alt texts in src/catalog.ts. */
const PHOTOS: Record<string, number> = {
  'alpine-dawn': 29,
  'blue-ridge': 1018,
  'desert-dusk': 184,
  'northern-night': 1022,
  'misty-pines': 1043,
  'violet-peaks': 1036,
  'glacier-noon': 1015,
  'ember-canyon': 1016,
  starfield: 1019,
  'meadow-haze': 110,
  tiny: 152,
  fern: 28,
}

/** Sources the recipe cases use, kept out of the gallery's list in subdirectories. */
const EXTRA_SCENES: (Scene & { file: string })[] = [
  // A 40 px original: every width request encodes 40 px, so it gets one URL.
  { file: 'extra/tiny.jpg', name: 'tiny', width: 40, height: 40, hue: 300 },
  // Served only to signed-in viewers in the live demo.
  { file: 'private/fern.jpg', name: 'fern', width: 1600, height: 1200, hue: 120 },
]

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">
  <rect width="120" height="40" rx="8" fill="#1f2937"/>
  <circle cx="20" cy="20" r="9" fill="#38bdf8"/>
  <text x="36" y="26" font-family="sans-serif" font-size="16" font-weight="700" fill="#f9fafb">Club</text>
</svg>
`

/** The photo for a scene at its size, re-encoded like a drawn one; false without network. */
async function photo({ name, width, height }: Scene, file: string): Promise<boolean> {
  const id = PHOTOS[name]
  if (id === undefined) return false
  try {
    const response = await fetch(`https://picsum.photos/id/${id}/${width}/${height}.jpg`, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await sharp(Buffer.from(await response.arrayBuffer()))
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(file)
    return true
  } catch (error) {
    console.warn(`No photo for ${name} (${String(error)}), drawing it instead.`)
    return false
  }
}

async function scene(scene: Scene, seed: number, file: string): Promise<void> {
  const base = await sharp(Buffer.from(svg(scene, seed))).png().toBuffer()
  await sharp(base)
    .composite([{ input: await detail(scene, seed), blend: 'overlay' }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(file)
}

/** A 64 px waving hand in six frames. */
async function wave(file: string): Promise<void> {
  const angles = [-20, -5, 10, 20, 10, -5]
  const frames = await Promise.all(
    angles.map((angle) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#fde68a"/>` +
            `<g transform="rotate(${angle} 32 52)"><circle cx="32" cy="24" r="14" fill="#f59e0b"/>` +
            `<rect x="26" y="30" width="12" height="22" rx="5" fill="#f59e0b"/></g></svg>`,
        ),
      )
        .png()
        .toBuffer(),
    ),
  )
  await sharp(frames, { join: { animated: true } }).gif({ loop: 0, delay: 120 }).toFile(file)
}

const exists = (file: string) => access(file).then(
  () => true,
  () => false,
)

/** What each file in the image directory is: `photo:<id>` or `drawn`. */
const SOURCES_FILE = '.sources.json'

/**
 * Renders every demo image that is missing from `dir`, and replaces a drawn
 * scene (or one from an older photo list) once its photo can be downloaded.
 */
export async function ensureDemoImages(dir: string): Promise<void> {
  const record = path.join(dir, SOURCES_FILE)
  const sources = JSON.parse(await readFile(record, 'utf8').catch(() => '{}')) as Record<string, string>
  type Job = [name: string, want: string | undefined, make: (file: string) => Promise<string | undefined>]
  const drawing = (s: Scene, seed: number): Job[2] => async (file) => ((await photo(s, file)) ? `photo:${PHOTOS[s.name]}` : (await scene(s, seed, file), 'drawn'))
  const jobs: Job[] = [
    ...SCENES.map((s, i): Job => [`${s.name}.jpg`, `photo:${PHOTOS[s.name]}`, drawing(s, i + 1)]),
    ...EXTRA_SCENES.map((s, i): Job => [s.file, `photo:${PHOTOS[s.name]}`, drawing(s, SCENES.length + i + 1)]),
    ['extra/logo.svg', undefined, async (file) => void (await writeFile(file, LOGO))],
    ['extra/wave.gif', undefined, async (file) => void (await wave(file))],
  ]
  let changed = false
  for (const [name, want, make] of jobs) {
    const file = path.join(dir, name)
    if ((await exists(file)) && (want === undefined || sources[name] === want)) continue
    await mkdir(path.dirname(file), { recursive: true })
    console.log(`Generating ${name} in ${dir} …`)
    // The demo server and the Vite prerender plugin may both generate at
    // once: each writes its own file (same extension, sharp picks the
    // format by it) and renames it into place, so neither reads a partial one.
    const temp = path.join(path.dirname(file), `.tmp-${process.pid}-${path.basename(file)}`)
    const made = await make(temp)
    // A drawn stand-in never replaces an existing file; the photo is retried next start.
    if (made === 'drawn' && (await exists(file))) {
      await rm(temp, { force: true })
      continue
    }
    const moved = await rename(temp, file).then(
      () => true,
      async (error: unknown) => {
        await rm(temp, { force: true })
        if (!(await exists(file))) throw error
        return false
      },
    )
    if (moved && made) {
      sources[name] = made
      changed = true
    }
  }
  if (changed) await writeFile(record, JSON.stringify(sources, null, 2))
}
