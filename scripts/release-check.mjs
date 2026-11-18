// Checks that the public packages can be released together (lockstep) and
// prints the order to publish them in.
//
//   pnpm check:release                    the working tree: one version, workspace ranges, changelog
//   node scripts/release-check.mjs --tag v1.2.3            what release.yml runs on a tag push
//   node scripts/release-check.mjs --tag v1.2.3 --dry-run  a dry run also accepts `## [Unreleased]`
//
// Every package under packages/ is public and published: one version for all
// of them, `publishConfig.access` public, the repository URL npm's Trusted
// Publishing compares, and `workspace:*` for each @lazy-ease dependency, which
// pnpm packs as the exact release version. With --tag the tag must be `v` plus
// that version and CHANGELOG.md needs a non-empty `## [version]` section and a
// link reference. Under GitHub Actions the results go to $GITHUB_OUTPUT: tag,
// version, prerelease and packages (directories in publication order).

import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { REPOSITORY_URL, publishOrder, root, workspacePackages } from './lib/release.mjs'

const { values: args } = parseArgs({ options: { tag: { type: 'string' }, 'dry-run': { type: 'boolean' } } })

const problems = []
const packages = workspacePackages()
let order = []
try {
  order = publishOrder(packages)
} catch (error) {
  problems.push(error.message)
}

const versions = new Set(packages.map((p) => p.version))
const version = packages[0]?.version
if (versions.size !== 1) {
  problems.push(`the packages are not in lockstep: ${packages.map((p) => `${p.name}@${p.version}`).join(', ')}`)
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) problems.push(`${version} is not a version like 1.2.3`)

for (const { dir, name, manifest, internal } of packages) {
  if (!name?.startsWith('@lazy-ease/')) problems.push(`${dir}: name ${name} is outside @lazy-ease`)
  if (manifest.private) problems.push(`${dir}: private packages don't belong under packages/`)
  if (manifest.publishConfig?.access !== 'public') problems.push(`${dir}: publishConfig.access must be "public"`)
  if (manifest.repository?.url !== REPOSITORY_URL) {
    problems.push(`${dir}: repository.url must be ${REPOSITORY_URL} (npm Trusted Publishing compares it)`)
  }
  if (manifest.repository?.directory !== dir) problems.push(`${dir}: repository.directory must be ${dir}`)
  if (manifest.license !== 'MIT') problems.push(`${dir}: license must be MIT`)
  for (const [field, dep, range] of internal) {
    if (range !== 'workspace:*') problems.push(`${dir}: ${field}.${dep} is ${range}, not workspace:* (packs as the exact release version)`)
  }
}

// The changelog section the GitHub Release is made from.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
const section = (heading) => {
  const start = changelog.findIndex((line) => line.startsWith(`## [${heading}]`))
  if (start === -1) return undefined
  const end = changelog.findIndex((line, i) => i > start && (line.startsWith('## ') || /^\[[^\]]+\]: /.test(line)))
  return changelog.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
}
const released = section(version)
const unreleased = section('Unreleased')
const tag = args.tag ?? `v${version}`
if (args.tag) {
  if (tag !== `v${version}`) problems.push(`the tag is ${tag}, the packages are at ${version}`)
  if (released) {
    if (!changelog.some((line) => line.startsWith(`[${version}]: `))) problems.push(`CHANGELOG.md has no [${version}] link reference`)
  } else if (!(args['dry-run'] && unreleased)) {
    problems.push(`CHANGELOG.md has no non-empty "## [${version}]" section`)
  }
} else if (!released && !unreleased) {
  problems.push(`CHANGELOG.md has neither a "## [${version}]" nor a non-empty "## [Unreleased]" section`)
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'))
  process.exit(1)
}

const prerelease = version.includes('-')
console.log(`${packages.length} packages at ${version}, in lockstep`)
console.log(`publication order: ${order.map((p) => p.name).join(', ')}`)
console.log(`changelog: ${released ? `## [${version}]` : '## [Unreleased] (rename it to the version before tagging)'}`)
if (process.env.GITHUB_OUTPUT) {
  const lines = [`tag=${tag}`, `version=${version}`, `prerelease=${prerelease}`, `packages=${order.map((p) => p.dir).join(' ')}`]
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}
