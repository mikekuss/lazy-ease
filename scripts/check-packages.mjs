// Checks the published shape of the packages: packs each one with pnpm, then
// runs publint and attw on the tarball and asserts what it contains.
// Run `pnpm build` first. Tarballs land in .cache/packs for scripts/next-smoke.mjs.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const packDir = join(root, '.cache', 'packs')

const common = (path) => path === 'package.json' || path === 'README.md' || path === 'LICENSE'
const built = {
  allowed: (path) => common(path) || path.startsWith('dist/'),
  required: ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'],
}

// @lazy-ease/testing has no build: plain ESM, its types and the JSON fixtures.
const fixtureNames = JSON.parse(readFileSync(join(root, 'packages/testing/fixtures/manifest.json'), 'utf8')).files.map((f) => f.name)
const testing = {
  allowed: (path) => common(path) || path === 'index.js' || path === 'index.d.ts' || /^fixtures\/[a-z]+\.json$/.test(path),
  required: ['package.json', 'README.md', 'LICENSE', 'index.js', 'index.d.ts', 'fixtures/manifest.json', ...fixtureNames.map((n) => `fixtures/${n}`)],
}

const packages = [
  // Files that must start with 'use client', so Server Components can import them.
  {
    dir: 'packages/core',
    clientFiles: [],
    ...built,
    required: [...built.required, 'dist/thumbhash.js', 'dist/thumbhash.d.ts', 'dist/dom/controller.js'],
    smoke: smokeCore,
  },
  {
    dir: 'packages/vanilla',
    clientFiles: [],
    ...built,
    required: [...built.required, 'dist/css.js', 'dist/css.d.ts', 'dist/lazy-ease.css', 'dist/lazy-ease.min.js'],
    smoke: smokeVanilla,
    // A stylesheet and a classic script: neither has types to resolve.
    attw: ['--exclude-entrypoints', './lazy-ease.css', './lazy-ease.min.js'],
  },
  { dir: 'packages/react', clientFiles: ['dist/Image.js', 'dist/context.js'], ...built },
  { dir: 'packages/server', clientFiles: [], ...built },
  { dir: 'packages/testing', clientFiles: [], ...testing, smoke: smokeTesting },
]

// Tarball entries by package name, for smoke tests that need a dependency.
const packed = new Map()
let failures = 0
const fail = (name, message) => {
  failures++
  console.error(`✗ ${name}: ${message}`)
}

// Under `pnpm run`, npm_execpath is pnpm's own script, so pnpm runs without a
// shell (pnpm is pnpm.cmd on Windows, which needs one).
const pnpmScript = process.env.npm_execpath
if (!pnpmScript || !/pnpm/.test(pnpmScript)) {
  console.error('Run this through pnpm: pnpm check:packages')
  process.exit(1)
}

function pnpm(args, cwd = root) {
  console.log(`$ pnpm ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [pnpmScript, ...args], { cwd, stdio: 'inherit' })
  return result.status === 0
}

/** Reads a .tgz into a map of path (without the leading `package/`) to contents. */
function readTarball(file) {
  const tar = gunzipSync(readFileSync(file))
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => header.toString('utf8', start, start + length).replace(/\0.*$/s, '')
    const name = field(0, 100)
    const prefix = field(345, 155)
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const path = prefix ? `${prefix}/${name}` : name
    offset += 512
    if (type === '0' || type === '') {
      entries.set(path.replace(/^package\//, ''), tar.subarray(offset, offset + size))
    }
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

/**
 * Installs the packed @lazy-ease/testing into a temporary node_modules and
 * imports it by name the way a consumer would: the main entry, a fixture by
 * its own export path, and every file checked against the manifest.
 */
function smokeTesting(entries) {
  const dir = install(entries, '@lazy-ease/testing')
  try {
    writeFileSync(
      join(dir, 'smoke.mjs'),
      `import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { casesOf, fixtures, manifest, FIXTURE_VERSION } from '@lazy-ease/testing'
import outputs from '@lazy-ease/testing/fixtures/outputs.json' with { type: 'json' }

const resolveFile = (name) => createRequire(import.meta.url).resolve('@lazy-ease/testing/fixtures/' + name)
if (FIXTURE_VERSION !== manifest.fixtureVersion) throw new Error('fixture version')
if (JSON.stringify(outputs) !== JSON.stringify(fixtures.outputs)) throw new Error('subpath export differs')
let cases = 0
for (const entry of manifest.files) {
  const bytes = readFileSync(resolveFile(entry.name))
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(entry.name + ' hash')
  const key = entry.name.replace(/\.json$/, '')
  if (fixtures[key].cases.length !== entry.cases || casesOf(key).length !== entry.cases) throw new Error(entry.name + ' cases')
  cases += entry.cases
}
console.log('imported @lazy-ease/testing: ' + manifest.files.length + ' files, ' + cases + ' cases')
`,
    )
    console.log('$ node smoke.mjs (packed @lazy-ease/testing)')
    const result = spawnSync(process.execPath, ['smoke.mjs'], { cwd: dir, stdio: 'inherit' })
    return result.status === 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Writes a tarball's entries into a temporary node_modules under `name`, next to `others` ({ name: entries }). */
function install(entries, name, others = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lazy-ease-smoke-'))
  for (const [packageName, files] of Object.entries({ ...others, [name]: entries })) {
    for (const [path, data] of files) {
      const file = join(dir, 'node_modules', ...packageName.split('/'), path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, data)
    }
  }
  return dir
}

/**
 * Installs the packed @lazy-ease/vanilla with the packed core and checks what
 * a consumer reaches by name: the ESM entries import without touching a
 * browser global, the CSS export path holds the same text as `cssText`, and
 * the script at its export path starts itself in a page (jsdom) and enhances
 * only the opted-in area.
 */
function smokeVanilla(entries) {
  const core = packed.get('@lazy-ease/core')
  if (!core) return false
  const dir = install(entries, '@lazy-ease/vanilla', { '@lazy-ease/core': core })
  const jsdom = createRequire(join(root, 'packages/react/package.json')).resolve('jsdom')
  try {
    writeFileSync(
      join(dir, 'smoke.mjs'),
      `import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const touched = []
const names = ['process', 'document', 'window', 'navigator', 'IntersectionObserver', 'ResizeObserver', 'matchMedia', 'Image', 'HTMLElement']
const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get: () => (touched.push(name), undefined) })
const vanilla = await import('@lazy-ease/vanilla')
const { cssText } = await import('@lazy-ease/vanilla/css')
for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]
if (touched.length) throw new Error('import touched ' + touched.join(', '))
if (typeof vanilla.enhance !== 'function' || typeof vanilla.readOptions !== 'function') throw new Error('exports')
const file = (path) => readFileSync(fileURLToPath(import.meta.resolve('@lazy-ease/vanilla/' + path)), 'utf8')
if (file('lazy-ease.css') !== cssText) throw new Error('lazy-ease.css differs from cssText')
const { JSDOM } = (await import(${JSON.stringify(pathToFileURL(jsdom).href)})).default
const inert = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const page = new JSDOM('<section data-le-auto><span data-le id="in"><img alt="" src="' + inert + '" data-le-srcset="/a.webp 640w" data-le-sizes="50vw"></span></section>' +
  '<span data-le id="out"><img alt="" src="' + inert + '" data-le-url="/b.webp"></span>', { runScripts: 'outside-only' })
page.window.eval(file('lazy-ease.min.js'))
const doc = page.window.document
// Like a deferred script, it waits until the document is parsed.
if (doc.readyState === 'loading') await new Promise((resolve) => doc.addEventListener('DOMContentLoaded', resolve))
if (doc.querySelector('#in img').getAttribute('srcset') !== '/a.webp 640w' || doc.querySelector('#in').dataset.state !== 'loading') throw new Error('the script did not enhance the opted-in area')
if (doc.querySelector('#out').hasAttribute('data-state')) throw new Error('the script enhanced outside data-le-auto')
console.log('imported @lazy-ease/vanilla without browser globals; the packed script enhanced its area')
`,
    )
    console.log('$ node smoke.mjs (packed @lazy-ease/vanilla)')
    return spawnSync(process.execPath, ['smoke.mjs'], { cwd: dir, stdio: 'inherit' }).status === 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Imports the packed @lazy-ease/core in plain Node the way a browser bundle
 * would see it: no process global, and every browser global a trap. Importing
 * both entry points and creating an instance must touch none of them and
 * build no ladder.
 */
function smokeCore(entries) {
  const dir = install(entries, '@lazy-ease/core')
  try {
    writeFileSync(
      join(dir, 'smoke.mjs'),
      `const touched = []
for (const name of ['process', 'document', 'window', 'navigator', 'IntersectionObserver', 'ResizeObserver', 'matchMedia', 'Image', 'requestAnimationFrame', 'getComputedStyle', 'devicePixelRatio', 'HTMLElement']) {
  Object.defineProperty(globalThis, name, { configurable: true, get: () => (touched.push(name), undefined) })
}
const toFixed = Number.prototype.toFixed
let computed = 0
Number.prototype.toFixed = function (digits) { computed++; return toFixed.call(this, digits) }
const core = await import('@lazy-ease/core')
const { thumbhashDecoder } = await import('@lazy-ease/core/thumbhash')
core.createLazyEase({ rootMargin: '200px' })
const loaded = Object.keys(core).length
Number.prototype.toFixed = toFixed
if (touched.length || computed) throw new Error('import touched ' + touched.join(', ') + ', toFixed calls: ' + computed)
if (typeof thumbhashDecoder !== 'function' || core.DEFAULT_RATIOS.length !== 73) throw new Error('exports')
console.log('imported @lazy-ease/core without process or browser globals: ' + loaded + ' exports')
`,
    )
    console.log('$ node smoke.mjs (packed @lazy-ease/core)')
    return spawnSync(process.execPath, ['smoke.mjs'], { cwd: dir, stdio: 'inherit' }).status === 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Paths of every `source` key under `exports`. */
function sourceConditions(value, path = 'exports') {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'source' ? [`${path}.source`] : sourceConditions(child, `${path}["${key}"]`),
  )
}

rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir, { recursive: true })

for (const { dir, clientFiles, allowed, required, smoke, attw = [] } of packages) {
  const before = new Set(readdirSync(packDir))
  if (!pnpm(['pack', '--pack-destination', relative(join(root, dir), packDir)], join(root, dir))) {
    fail(dir, 'pnpm pack failed')
    continue
  }
  const tarball = readdirSync(packDir).find((file) => !before.has(file))
  const file = join(packDir, tarball)
  const entries = readTarball(file)
  const manifest = JSON.parse(entries.get('package.json').toString('utf8'))
  const name = manifest.name
  packed.set(name, entries)
  console.log(`\n== ${name}: ${relative(root, file)} (${entries.size} files)`)

  // Shape of the tarball.
  for (const path of entries.keys()) if (!allowed(path)) fail(name, `unexpected file in tarball: ${path}`)
  for (const path of required) if (!entries.has(path)) fail(name, `missing from tarball: ${path}`)
  for (const path of sourceConditions(manifest.exports)) fail(name, `packed package.json has ${path}`)
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (range.startsWith('workspace:')) fail(name, `${field}.${dep} is ${range}`)
    }
  }
  for (const path of clientFiles) {
    const code = entries.get(path)?.toString('utf8') ?? ''
    if (!/^\s*['"]use client['"]/.test(code)) fail(name, `${path} doesn't start with 'use client'`)
  }

  // Lint the tarball as npm would install it.
  const tgz = relative(root, file)
  if (!pnpm(['exec', 'publint', 'run', tgz, '--strict'])) fail(name, 'publint failed')
  // The packages are ESM-only ("type": "module", no CJS build). The esm-only
  // profile skips the node10 and node16-from-CJS resolution modes, where an
  // ESM-only package can't resolve by design. node16-from-ESM and bundler
  // must still pass.
  if (!pnpm(['exec', 'attw', tgz, '--profile', 'esm-only', ...attw])) fail(name, 'attw failed')
  if (smoke && !smoke(entries)) fail(name, 'import smoke test failed')
}

if (failures) {
  console.error(`\n${failures} package check(s) failed`)
  process.exit(1)
}
console.log('\nAll package checks passed')
