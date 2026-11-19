// Compares the tarballs scripts/pack.mjs wrote with what npm already has, for
// release.yml, before anything is uploaded.
//
//   node scripts/check-published.mjs <pack-dir> [--dry-run]
//
// For each package in <pack-dir>/packed.json:
//   - not on npm at all: Trusted Publishing can't create it (RELEASING.md,
//     "First publish of a new package"). An error, a warning with --dry-run.
//   - this version is on npm: downloads it and compares every file with the
//     tarball packed here. Any difference fails, so a re-run never skips a
//     version that was published from other code. If the files match, the
//     package is marked `published` in packed.json (the Publish step skips it)
//     and its entry in release.json takes npm's tarball size, integrity and
//     shasum, because a version published by hand on another machine is a
//     different gzip of the same files.
//   - otherwise: left for the Publish step.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readTarball } from './lib/release.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dirArg = args.find((a) => !a.startsWith('--'))
if (!dirArg) {
  console.error('usage: node scripts/check-published.mjs <pack-dir> [--dry-run]')
  process.exit(2)
}
const dir = resolve(dirArg)
const packedFile = join(dir, 'packed.json')
const releaseFile = join(dir, 'release.json')
const packed = JSON.parse(readFileSync(packedFile, 'utf8'))
const release = JSON.parse(readFileSync(releaseFile, 'utf8'))

const shell = process.platform === 'win32'
/** `npm view <spec> <field> --json`, or undefined when npm has no such package or version. */
const view = (spec, field) => {
  try {
    const out = execFileSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'] })
    return out.trim() ? JSON.parse(out) : undefined
  } catch (error) {
    if (/E404/.test(String(error.stderr))) return undefined
    throw error
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'lazy-ease-published-'))
const missing = []
const problems = []
try {
  for (const p of packed) {
    const spec = `${p.name}@${p.version}`
    if (view(p.name, 'name') === undefined) {
      missing.push(p.name)
      continue
    }
    const dist = view(spec, 'dist')
    if (!dist) {
      console.log(`${spec}: not on npm yet, the Publish step uploads it`)
      continue
    }
    const info = JSON.parse(execFileSync('npm', ['pack', spec, '--json', '--pack-destination', tmp], { encoding: 'utf8', shell }))
    const remoteFile = join(tmp, info[0].filename)
    const remote = readTarball(remoteFile)
    const local = readTarball(p.tarball)
    const differ = [...new Set([...remote.keys(), ...local.keys()])]
      .filter((path) => !remote.has(path) || !local.has(path) || !remote.get(path).equals(local.get(path)))
      .sort()
    if (differ.length > 0) {
      problems.push(`${spec} on npm differs from the tarball packed here in ${differ.join(', ')}`)
      continue
    }
    const entry = release.packages.find((r) => r.name === p.name)
    if (dist.integrity !== p.integrity) {
      console.log(`${spec}: on npm with the same files, another gzip (published elsewhere); release.json takes npm's integrity`)
    } else console.log(`${spec}: on npm, identical`)
    Object.assign(entry, { size: readFileSync(remoteFile).length, integrity: dist.integrity, shasum: dist.shasum })
    Object.assign(p, { integrity: dist.integrity, published: true })
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (missing.length > 0) {
  const message = `Not on npm yet, publish the first version by hand (RELEASING.md): ${missing.join(' ')}`
  if (dryRun) console.log(`::warning::${message}`)
  else problems.push(message)
}
if (problems.length > 0) {
  for (const p of problems) console.log(`::error::${p}`)
  process.exit(1)
}
writeFileSync(packedFile, `${JSON.stringify(packed, null, 2)}\n`)
writeFileSync(releaseFile, `${JSON.stringify(release, null, 2)}\n`)
