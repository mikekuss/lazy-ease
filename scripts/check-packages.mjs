// Checks the published shape of the packages: packs each one with pnpm, then
// runs publint and attw on the tarball and asserts what it contains.
// Run `pnpm build` first. Tarballs land in .cache/packs for scripts/next-smoke.mjs.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const packDir = join(root, '.cache', 'packs')

const packages = [
  // Files that must start with 'use client', so Server Components can import them.
  { dir: 'packages/core', clientFiles: [] },
  { dir: 'packages/react', clientFiles: ['dist/Image.js', 'dist/context.js'] },
  { dir: 'packages/server', clientFiles: [] },
]

const allowed = (path) =>
  path === 'package.json' || path === 'README.md' || path === 'LICENSE' || path.startsWith('dist/')
const required = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']

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

/** Paths of every `source` key under `exports`. */
function sourceConditions(value, path = 'exports') {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'source' ? [`${path}.source`] : sourceConditions(child, `${path}["${key}"]`),
  )
}

rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir, { recursive: true })

for (const { dir, clientFiles } of packages) {
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
  // Both packages are ESM-only ("type": "module", no CJS build). The esm-only
  // profile skips the node10 and node16-from-CJS resolution modes, where an
  // ESM-only package can't resolve by design. node16-from-ESM and bundler
  // must still pass.
  if (!pnpm(['exec', 'attw', tgz, '--profile', 'esm-only'])) fail(name, 'attw failed')
}

if (failures) {
  console.error(`\n${failures} package check(s) failed`)
  process.exit(1)
}
console.log('\nAll package checks passed')
