// Checks the published shape of the packages: packs each one with pnpm, then
// runs publint and attw on the tarball, asserts what it contains and installs
// it into a temporary node_modules (next to the packed packages it needs) to
// use every entry point the way a consumer does: plain Node imports, a
// production esbuild bundle (tree shaking, sideEffects, the stylesheet) and,
// for react and server, a render. The packed `sideEffects` field is checked
// directly too: a bundle of a provably pure module tree-shakes without it.
// Run `pnpm build` first. Tarballs land in .cache/packs for scripts/next-smoke.mjs.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { internalDependencies, readTarball, root, workspacePackages } from './lib/release.mjs'

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

// Files in clientFiles must start with 'use client', so Server Components can import them.
// sideEffects is the exact value the packed package.json must have.
// A package's packed @lazy-ease dependencies are packed before it.
const packages = [
  {
    dir: 'packages/core',
    clientFiles: [],
    sideEffects: false,
    ...built,
    required: [...built.required, 'dist/thumbhash.js', 'dist/thumbhash.d.ts', 'dist/dom/controller.js'],
    smoke: smokeCore,
  },
  {
    dir: 'packages/vanilla',
    clientFiles: [],
    sideEffects: ['*.css', './dist/lazy-ease.min.js'],
    ...built,
    required: [...built.required, 'dist/css.js', 'dist/css.d.ts', 'dist/lazy-ease.css', 'dist/lazy-ease.min.js'],
    smoke: smokeVanilla,
    // A stylesheet and a classic script: neither has types to resolve.
    attw: ['--exclude-entrypoints', './lazy-ease.css', './lazy-ease.min.js'],
  },
  { dir: 'packages/react', clientFiles: ['dist/Image.js', 'dist/context.js'], sideEffects: false, ...built, smoke: smokeReact },
  { dir: 'packages/server', clientFiles: [], sideEffects: false, ...built, smoke: smokeServer },
  { dir: 'packages/testing', clientFiles: [], sideEffects: false, ...testing, smoke: smokeTesting },
]
for (const { dir } of workspacePackages()) {
  if (!packages.some((p) => p.dir === dir)) {
    console.error(`${dir} is not checked here; add it to the list in scripts/check-packages.mjs`)
    process.exit(1)
  }
}

// The workspace's own installs of the third-party packages a smoke test needs.
const requireFrom = (dir) => createRequire(join(root, dir, 'package.json'))
const esbuild = requireFrom('packages/vanilla')('esbuild')
const thirdParty = {
  react: 'packages/react',
  'react-dom': 'packages/react',
  thumbhash: 'packages/server',
  hono: 'packages/server',
  sharp: 'packages/server',
}

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

/**
 * Writes a tarball's entries into a temporary node_modules under `name`, next
 * to the packed @lazy-ease packages it depends on and links to the
 * workspace's installs of `links` (third-party packages).
 */
function install(entries, name, links = []) {
  const dir = mkdtempSync(join(tmpdir(), 'lazy-ease-smoke-'))
  const manifest = JSON.parse(entries.get('package.json').toString('utf8'))
  const others = Object.fromEntries(internalDependencies(manifest).map(([, dep]) => [dep, packed.get(dep)]))
  for (const [packageName, files] of Object.entries({ ...others, [name]: entries })) {
    if (!files) throw new Error(`${packageName} must be packed before ${name}`)
    for (const [path, data] of files) {
      const file = join(dir, 'node_modules', ...packageName.split('/'), path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, data)
    }
  }
  for (const dep of links) {
    const target = realpathSync(join(root, thirdParty[dep], 'node_modules', dep))
    symlinkSync(target, join(dir, 'node_modules', dep), 'junction')
  }
  return dir
}

/** Runs `code` as smoke.mjs inside an install directory. */
function runSmoke(dir, label, code) {
  writeFileSync(join(dir, 'smoke.mjs'), code)
  console.log(`$ node smoke.mjs (${label})`)
  return spawnSync(process.execPath, ['smoke.mjs'], { cwd: dir, stdio: 'inherit' }).status === 0
}

/**
 * Bundles `code` inside an install directory as an application's production
 * build would: esbuild, minified, tree-shaken, honoring each package's
 * sideEffects. Returns the JavaScript and the CSS it emits.
 */
async function bundle(dir, code) {
  const result = await esbuild.build({
    stdin: { contents: code, resolveDir: dir, loader: 'js' },
    absWorkingDir: dir,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
    define: { 'process.env.NODE_ENV': '"production"' },
    outdir: join(dir, 'out'),
    write: false,
    logLevel: 'silent',
  })
  const text = (extension) =>
    result.outputFiles
      .filter((file) => file.path.endsWith(extension))
      .map((file) => file.text)
      .join('')
      .trim()
  return { js: text('.js'), css: text('.css') }
}

/** Fails unless importing the specifiers only for their side effects bundles to nothing. */
async function bundlesToNothing(dir, name, specifiers) {
  const { js } = await bundle(dir, specifiers.map((s) => `import '${s}'`).join('\n'))
  if (js) console.error(`✗ ${name}: importing ${specifiers.join(', ')} for side effects left ${js.length} B in a production bundle`)
  else console.log(`✓ ${specifiers.join(', ')}: nothing left in a production bundle (sideEffects)`)
  return !js
}

/**
 * Installs the packed @lazy-ease/vanilla with the packed core and checks what
 * a consumer reaches by name: the ESM entries import without touching a
 * browser global, the CSS export path holds the same text as `cssText`, and
 * the script at its export path starts itself in a page (jsdom) and enhances
 * only the opted-in area. In a production bundle the ESM entries leave
 * nothing when unused, while the stylesheet and the script are kept
 * (sideEffects).
 */
async function smokeVanilla(entries) {
  const dir = install(entries, '@lazy-ease/vanilla')
  const jsdom = requireFrom('packages/react').resolve('jsdom')
  try {
    const ran = runSmoke(
      dir,
      'packed @lazy-ease/vanilla',
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
    if (!ran) return false
    let ok = await bundlesToNothing(dir, '@lazy-ease/vanilla', ['@lazy-ease/vanilla', '@lazy-ease/vanilla/css'])

    // The stylesheet import survives tree shaking and carries the whole sheet.
    const sheet = readFileSync(join(dir, 'node_modules/@lazy-ease/vanilla/dist/lazy-ease.css'), 'utf8')
    const minifiedSheet = (await esbuild.transform(sheet, { loader: 'css', minify: true })).code.trim()
    const app = await bundle(dir, `import '@lazy-ease/vanilla/lazy-ease.css'\nimport { enhance } from '@lazy-ease/vanilla'\nexport const run = enhance`)
    if (app.css !== minifiedSheet) {
      console.error(`✗ @lazy-ease/vanilla: the bundled stylesheet (${app.css.length} B) is not lazy-ease.css (${minifiedSheet.length} B minified)`)
      ok = false
    } else console.log(`✓ import '@lazy-ease/vanilla/lazy-ease.css': the whole sheet is in the production CSS (${app.css.length} B)`)

    // The self-starting script is kept when imported for its side effect.
    const script = readFileSync(join(dir, 'node_modules/@lazy-ease/vanilla/dist/lazy-ease.min.js'), 'utf8')
    const started = await bundle(dir, `import '@lazy-ease/vanilla/lazy-ease.min.js'`)
    if (started.js.length < script.length * 0.9) {
      console.error(`✗ @lazy-ease/vanilla: import '@lazy-ease/vanilla/lazy-ease.min.js' left ${started.js.length} B of ${script.length} B`)
      ok = false
    } else console.log(`✓ import '@lazy-ease/vanilla/lazy-ease.min.js': kept in a production bundle (${started.js.length} B)`)
    return ok
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Imports the packed @lazy-ease/core in plain Node the way a browser bundle
 * would see it: no process global, and every browser global a trap. Importing
 * both entry points and creating an instance must touch none of them and
 * build no ladder. The optional decoder then runs with the real `thumbhash`
 * package, and a production bundle drops both entries when they are unused.
 */
async function smokeCore(entries) {
  const dir = install(entries, '@lazy-ease/core', ['thumbhash'])
  try {
    const ran = runSmoke(
      dir,
      'packed @lazy-ease/core',
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

// The optional decoder with the package an application installs.
const thumbhash = await import('thumbhash')
const placeholder = thumbhashDecoder(thumbhash)('1QcSHQRnh493V4dIh4eXh1h4kJUI')
const image = placeholder?.lazy?.()
if (!/^#[0-9a-f]{6}$/.test(placeholder?.style.backgroundColor ?? '') || !['url("data:image/svg+xml,', 'feGaussianBlur', "href='data:image/png;base64,"].every((part) => String(image?.backgroundImage).includes(part))) {
  throw new Error('thumbhashDecoder: ' + JSON.stringify({ style: placeholder?.style, image }))
}
console.log('@lazy-ease/core/thumbhash decoded a hash with thumbhash: ' + placeholder.style.backgroundColor)
`,
    )
    return ran && (await bundlesToNothing(dir, '@lazy-ease/core', ['@lazy-ease/core', '@lazy-ease/core/thumbhash']))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Renders the packed @lazy-ease/react on the server with the packed core
 * beside it (React from the workspace): a deferred image and a priority one.
 * Checks that react resolves exactly the packed core of the same version, and
 * that an unused import leaves nothing in a production bundle.
 */
async function smokeReact(entries) {
  const dir = install(entries, '@lazy-ease/react', ['react', 'react-dom'])
  try {
    const ran = runSmoke(
      dir,
      'packed @lazy-ease/react',
      `import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Image, LazyEaseProvider } from '@lazy-ease/react'

// The manifest of the package \`name\` resolves to from \`from\` (the packages don't export ./package.json).
const manifest = (from, name) => JSON.parse(readFileSync(join(dirname(createRequire(from).resolve(name)), '..', 'package.json'), 'utf8'))
const react = manifest(import.meta.url, '@lazy-ease/react')
const core = manifest(createRequire(import.meta.url).resolve('@lazy-ease/react'), '@lazy-ease/core')
if (core.version !== react.version || react.dependencies['@lazy-ease/core'] !== core.version) {
  throw new Error('react ' + react.version + ' needs core ' + react.dependencies['@lazy-ease/core'] + ' and resolved ' + core.version)
}
const html = renderToString(
  createElement(LazyEaseProvider, null,
    createElement(Image, { src: '/a.jpg', alt: 'Lake', width: 320, height: 240 }),
    createElement(Image, { src: '/hero.jpg', alt: 'Hero', width: 640, height: 320, priority: true })),
)
// Without the source size a priority image gets one URL, for 2x its width snapped to the ladder, preloaded from the same string.
const hero = '/_img/hero.jpg?ar=2&amp;fmt=webp&amp;q=75&amp;w=1440'
const expected = ['alt="Lake"', 'data-le', 'data:image/gif;base64,', 'alt="Hero"', 'fetchPriority="high"', 'rel="preload" href="' + hero + '"', 'src="' + hero + '"']
const missing = expected.filter((needle) => !html.includes(needle))
if (missing.length) throw new Error('server HTML lacks ' + missing.join(', ') + ':\\n' + html)
console.log('rendered @lazy-ease/react ' + react.version + ' on the server with the packed core ' + core.version)
`,
    )
    return ran && (await bundlesToNothing(dir, '@lazy-ease/react', ['@lazy-ease/react']))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Runs the packed @lazy-ease/server with the packed core beside it (hono and
 * sharp from the workspace): metadata for a generated source, one render
 * through the mounted app, and the packed core as the one it resolves.
 */
function smokeServer(entries) {
  const dir = install(entries, '@lazy-ease/server', ['hono', 'sharp', 'thumbhash'])
  try {
    return runSmoke(
      dir,
      'packed @lazy-ease/server',
      `import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Hono } from 'hono'
import sharp from 'sharp'
import { computeMetadata, createImageApp, memoryStorage } from '@lazy-ease/server'

// The manifest of the package \`name\` resolves to from \`from\` (the packages don't export ./package.json).
const manifest = (from, name) => JSON.parse(readFileSync(join(dirname(createRequire(from).resolve(name)), '..', 'package.json'), 'utf8'))
const server = manifest(import.meta.url, '@lazy-ease/server')
const core = manifest(createRequire(import.meta.url).resolve('@lazy-ease/server'), '@lazy-ease/core')
if (core.version !== server.version || server.dependencies['@lazy-ease/core'] !== core.version) throw new Error('core ' + core.version)

mkdirSync('images')
await sharp({ create: { width: 400, height: 200, channels: 3, background: '#3366cc' } }).jpeg().toFile('images/a.jpg')
const meta = await computeMetadata('images/a.jpg')
if (meta.width !== 400 || meta.height !== 200 || !meta.revision) throw new Error('metadata ' + JSON.stringify(meta))

const app = new Hono()
app.route('/_img', createImageApp({ root: 'images', storage: memoryStorage() }))
const response = await app.request('/_img/a.jpg?ar=1&fmt=webp&q=75&v=' + meta.revision + '&w=64')
const body = Buffer.from(await response.arrayBuffer())
const out = response.status === 200 && (await sharp(body).metadata())
if (!out || out.format !== 'webp' || out.width !== 64 || out.height !== 64) throw new Error(response.status + ' ' + JSON.stringify(out))
if (!/immutable/.test(response.headers.get('cache-control') ?? '')) throw new Error('cache-control ' + response.headers.get('cache-control'))
console.log('rendered a 64x64 WebP with the packed @lazy-ease/server ' + server.version + ' and core ' + core.version)
`,
    )
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

for (const { dir, clientFiles, sideEffects, allowed, required, smoke, attw = [] } of packages) {
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
  if (JSON.stringify(manifest.sideEffects) !== JSON.stringify(sideEffects)) {
    fail(name, `packed sideEffects is ${JSON.stringify(manifest.sideEffects)}, not ${JSON.stringify(sideEffects)}`)
  }
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (range.startsWith('workspace:')) fail(name, `${field}.${dep} is ${range}`)
    }
  }
  // Lockstep: a @lazy-ease dependency is the exact version of this release.
  for (const [field, dep, range] of internalDependencies(manifest)) {
    if (range !== manifest.version) fail(name, `${field}.${dep} is ${range}, not ${manifest.version}`)
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
  if (smoke && !(await smoke(entries))) fail(name, 'import smoke test failed')
}

if (failures) {
  console.error(`\n${failures} package check(s) failed`)
  process.exit(1)
}
console.log('\nAll package checks passed')
