// Collects the conformance fixtures for a GitHub release from the packed
// @lazy-ease/testing tarball, so the assets are byte for byte what npm ships.
//
//   node scripts/fixture-assets.mjs <out-dir> [tarball]
//
// Without a tarball it takes the one `pnpm check:packages` left in .cache/packs.
// Writes manifest.json and every file it lists into <out-dir>, after checking
// each file's length and SHA-256 against the manifest. <out-dir> must be new or
// empty; an existing non-empty directory is refused, never cleared. Upload the
// files unchanged, e.g. `gh release upload "$TAG" <out-dir>/*.json`.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const [outArg, tarballArg] = process.argv.slice(2)
if (!outArg) {
  console.error('usage: node scripts/fixture-assets.mjs <out-dir> [tarball]')
  process.exit(2)
}
const out = resolve(outArg)
if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length > 0)) {
  console.error(`${out} exists and is not an empty directory. Pass a new or empty one.`)
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const packDir = join(root, '.cache', 'packs')
let tarball = tarballArg && resolve(tarballArg)
if (!tarball) {
  const found = readdirSync(packDir, { withFileTypes: true }).find(
    (entry) => entry.isFile() && /^lazy-ease-testing-.*\.tgz$/.test(entry.name),
  )
  if (!found) {
    console.error('No @lazy-ease/testing tarball in .cache/packs. Run `pnpm build && pnpm check:packages` first.')
    process.exit(1)
  }
  tarball = join(packDir, found.name)
}

/** Every regular file of a .tgz, keyed by path without the leading `package/`. */
function readTarball(file) {
  const tar = gunzipSync(readFileSync(file))
  const entries = new Map()
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => header.toString('utf8', start, start + length).replace(/\0.*$/s, '')
    const name = field(0, 100)
    const prefix = field(345, 155)
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    offset += 512
    if (type === '0' || type === '') {
      entries.set((prefix ? `${prefix}/${name}` : name).replace(/^package\//, ''), tar.subarray(offset, offset + size))
    }
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

const entries = readTarball(tarball)
const manifestBytes = entries.get('fixtures/manifest.json')
if (!manifestBytes) {
  console.error(`${tarball} has no fixtures/manifest.json`)
  process.exit(1)
}
const manifest = JSON.parse(manifestBytes.toString('utf8'))
const assets = [['manifest.json', manifestBytes]]
const problems = []
for (const { name, bytes, sha256 } of manifest.files) {
  const data = entries.get(`fixtures/${name}`)
  if (!data) {
    problems.push(`${name} is missing from the tarball`)
    continue
  }
  if (data.byteLength !== bytes) problems.push(`${name} has ${data.byteLength} bytes, the manifest says ${bytes}`)
  if (createHash('sha256').update(data).digest('hex') !== sha256) problems.push(`${name} does not match its SHA-256`)
  assets.push([name, data])
}
if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'))
  process.exit(1)
}

mkdirSync(out, { recursive: true })
for (const [name, data] of assets) writeFileSync(join(out, name), data, { flag: 'wx' })
console.log(`${assets.length} fixture assets (format ${manifest.format} ${manifest.fixtureVersion}) written to ${out}`)
