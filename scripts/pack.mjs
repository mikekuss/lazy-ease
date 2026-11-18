// Packs the public packages for release.yml the way they are published.
//
//   node scripts/pack.mjs <out-dir> [<package-dir>...]
//
// Run `pnpm build` first. Without package directories it packs every package
// under packages/, in publication order (scripts/release-check.mjs). For each
// one this runs `pnpm pack` (which applies `publishConfig` and turns
// `workspace:*` into the exact version, unlike `npm pack`), then fails if the
// packed package.json still has a `source` export condition, points at a file
// that isn't in the tarball, or needs a @lazy-ease package at another version.
//
// Writes into <out-dir>:
//   packed.json   [{ name, version, tarball, integrity }] in publication order, for the
//                 Publish step
//   release.json  the release asset: version, commit, and per package its
//                 tarball name, size, npm integrity and shasum, @lazy-ease
//                 dependencies and every file with its size and SHA-256

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { internalDependencies, publishOrder, readTarball, root, workspacePackages } from './lib/release.mjs'

const [outArg, ...dirArgs] = process.argv.slice(2)
if (!outArg) {
  console.error('usage: node scripts/pack.mjs <out-dir> [<package-dir>...]')
  process.exit(2)
}

const order = publishOrder(workspacePackages())
const dirs = dirArgs.length > 0 ? dirArgs : order.map((p) => p.dir)
const out = resolve(outArg)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const shell = process.platform === 'win32'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', shell, ...opts })
const digest = (algorithm, data, encoding) => createHash(algorithm).update(data).digest(encoding)

const problems = []
const packed = []
const released = []

for (const dir of dirs) {
  const cwd = resolve(root, dir)
  const info = JSON.parse(run('pnpm', ['pack', '--json', '--pack-destination', out], { cwd }))
  const tarball = resolve(out, basename(info.filename))
  const entries = readTarball(tarball)
  const manifest = JSON.parse(entries.get('package.json').toString('utf8'))
  const label = `${manifest.name}@${manifest.version}`
  console.log(`\n${label}: ${basename(tarball)}, ${entries.size} files`)

  // Walk `exports` for conditions and targets.
  const walk = (node, path) => {
    if (typeof node === 'string') {
      const target = node.replace(/^\.\//, '')
      if (!target.includes('*') && !entries.has(target)) {
        problems.push(`${label}: ${path} points at ${node}, which is not in the tarball`)
      }
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'source') problems.push(`${label}: ${path} has a "source" condition (${JSON.stringify(value)})`)
        walk(value, `${path}[${JSON.stringify(key)}]`)
      }
    }
  }
  if (!manifest.exports) problems.push(`${label}: packed package.json has no exports`)
  walk(manifest.exports, 'exports')

  // Lockstep: every @lazy-ease dependency is the exact version being released.
  const dependencies = {}
  for (const [field, name, range] of internalDependencies(manifest)) {
    dependencies[name] = range
    if (range !== manifest.version) problems.push(`${label}: ${field}.${name} is ${range}, not ${manifest.version}`)
  }

  const bytes = readFileSync(tarball)
  const integrity = `sha512-${digest('sha512', bytes, 'base64')}`
  packed.push({ name: manifest.name, version: manifest.version, tarball, integrity })
  released.push({
    name: manifest.name,
    version: manifest.version,
    tarball: basename(tarball),
    size: bytes.length,
    integrity,
    shasum: digest('sha1', bytes, 'hex'),
    dependencies,
    files: [...entries]
      .map(([path, data]) => ({ path, size: data.length, sha256: digest('sha256', data, 'hex') }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  })
}

// Dependencies come first, so the Publish step never uploads a package before one it needs.
const position = new Map(packed.map((p, i) => [p.name, i]))
for (const p of released) {
  for (const name of Object.keys(p.dependencies)) {
    if (position.has(name) && position.get(name) > position.get(p.name)) {
      problems.push(`${p.name} is packed before its dependency ${name}`)
    }
  }
}

const versions = new Set(packed.map((p) => p.version))
const commit = process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim()
writeFileSync(resolve(out, 'packed.json'), `${JSON.stringify(packed, null, 2)}\n`)
writeFileSync(
  resolve(out, 'release.json'),
  `${JSON.stringify({ format: 'lazy-ease-release', version: [...versions].join(' '), commit, packages: released }, null, 2)}\n`,
)

if (versions.size > 1) problems.push(`the tarballs are not in lockstep: ${packed.map((p) => `${p.name}@${p.version}`).join(', ')}`)
if (problems.length > 0) {
  console.error(`\n${problems.map((p) => `✗ ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`\nAll ${packed.length} tarballs OK, written to ${out}`)
