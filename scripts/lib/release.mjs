// Shared by the release scripts: the public workspace packages, their
// publication order and a reader for the tarballs pnpm packs.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const root = resolve(import.meta.dirname, '..', '..')
export const REPOSITORY_URL = 'git+https://github.com/mikekuss/lazy-ease.git'
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']

/** Every package under packages/, with its manifest and the @lazy-ease packages it needs at install time. */
export function workspacePackages() {
  const base = join(root, 'packages')
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'package.json')))
    .map((entry) => {
      const dir = `packages/${entry.name}`
      const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
      return { dir, name: manifest.name, version: manifest.version, manifest, internal: internalDependencies(manifest) }
    })
}

/** `[field, name, range]` for each @lazy-ease package a manifest depends on (devDependencies excluded). */
export function internalDependencies(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([name]) => name.startsWith('@lazy-ease/'))
      .map(([name, range]) => [field, name, range]),
  )
}

/**
 * The packages in publication order: each one after the packages it depends
 * on, so npm never holds a version whose exact @lazy-ease dependency is
 * missing. Ties keep directory order, so the order is stable.
 */
export function publishOrder(packages) {
  const byName = new Map(packages.map((p) => [p.name, p]))
  const order = []
  const state = new Map()
  const visit = (p, chain) => {
    if (state.get(p.name) === 'done') return
    if (state.get(p.name) === 'visiting') throw new Error(`dependency cycle: ${[...chain, p.name].join(' -> ')}`)
    state.set(p.name, 'visiting')
    for (const [, name] of p.internal) {
      const dep = byName.get(name)
      if (!dep) throw new Error(`${p.name} depends on ${name}, which is not a workspace package`)
      visit(dep, [...chain, p.name])
    }
    state.set(p.name, 'done')
    order.push(p)
  }
  for (const p of packages) visit(p, [])
  return order
}

/** Every regular file of a .tgz (plain ustar, as npm and pnpm write it), keyed by path without the leading `package/`. */
export function readTarball(file) {
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
