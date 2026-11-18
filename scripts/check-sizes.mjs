// Measures each public entry against its budget: esbuild (the version pinned
// in packages/vanilla), ES2022 ESM, minified, production define, React peers
// external, Brotli quality 11. The entries are the fixtures in scripts/sizes;
// the IIFE and the stylesheet are the published files. Run `pnpm build` first.
// The result depends only on these inputs: a different esbuild is refused.
//
//   pnpm check:sizes                    fails when an entry is over its budget
//   pnpm check:sizes --details          also lists each entry's largest inputs
//   pnpm check:sizes --packed           measures the tarballs `pnpm check:packages` left in .cache/packs
//   pnpm check:sizes --json <file>      also writes the measurements as JSON
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { brotliCompressSync, constants } from 'node:zlib'
import { readTarball, root } from './lib/release.mjs'

const ESBUILD = '0.28.2'
const { build, version } = createRequire(path.join(root, 'packages/vanilla/package.json'))('esbuild')
if (version !== ESBUILD) {
  console.error(`esbuild ${version} is installed; the budgets are measured with ${ESBUILD} (docs/design-spec.md)`)
  process.exit(1)
}
const { values: args } = parseArgs({ options: { details: { type: 'boolean' }, packed: { type: 'boolean' }, json: { type: 'string' } } })

// Approved 0.3 budgets, in Brotli bytes; `goal` is the target of the size pass after 0.3 (docs/design-spec.md).
const ENTRIES = [
  { name: 'createLoader', fixture: 'create-loader.js', budget: 1000, goal: 1000 },
  { name: 'attach (with controller)', fixture: 'attach.js', budget: 5400, goal: 3500 },
  { name: 'enhance (with controller)', fixture: 'enhance.js', budget: 6000, goal: 4000 },
  { name: 'IIFE lazy-ease.min.js', file: ['vanilla', 'dist/lazy-ease.min.js'], budget: 6600, goal: 4500 },
  { name: 'CSS lazy-ease.css', file: ['vanilla', 'dist/lazy-ease.css'], budget: 500, goal: 500 },
  { name: 'React Image', fixture: 'image.js', budget: 7900, goal: 5000 },
]

// The packages as a consumer imports them: their published `exports` entry,
// from the workspace's dist or, with --packed, from the tarballs.
const packages = {}
let unpacked
if (args.packed) {
  const packDir = path.join(root, '.cache', 'packs')
  unpacked = mkdtempSync(path.join(tmpdir(), 'lazy-ease-sizes-'))
  for (const name of ['core', 'vanilla', 'react']) {
    const tarball = readdirSync(packDir).find((file) => file.startsWith(`lazy-ease-${name}-`) && file.endsWith('.tgz'))
    if (!tarball) {
      console.error(`No @lazy-ease/${name} tarball in .cache/packs. Run \`pnpm build && pnpm check:packages\` first.`)
      process.exit(1)
    }
    const dir = path.join(unpacked, name)
    for (const [file, data] of readTarball(path.join(packDir, tarball))) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), data)
    }
    packages[name] = { dir, tarball }
  }
} else {
  for (const name of ['core', 'vanilla', 'react']) packages[name] = { dir: path.join(root, 'packages', name) }
}
const manifestOf = (name) => JSON.parse(readFileSync(path.join(packages[name].dir, 'package.json'), 'utf8'))
const alias = Object.fromEntries(
  Object.keys(packages).map((name) => {
    const manifest = manifestOf(name)
    const entry = manifest.publishConfig?.exports?.['.'] ?? manifest.exports['.']
    return [manifest.name, path.join(packages[name].dir, entry.default)]
  }),
)
const brotli = (bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const details = args.details
const module = (input) => input.replace(/^.*?packages\//, '').replace(/^.*node_modules\//, '')

const source = args.packed ? `the tarballs (${Object.values(packages).map((p) => p.tarball).join(', ')})` : 'the workspace dist'
console.log(`esbuild ${version}, ES2022 ESM, minified, production, Brotli 11; from ${source}`)
let failed = false
const results = []
for (const entry of ENTRIES) {
  let bytes
  let inputs = []
  if (entry.file) bytes = readFileSync(path.join(packages[entry.file[0]].dir, entry.file[1]))
  else {
    const result = await build({
      entryPoints: [path.join(root, 'scripts/sizes', entry.fixture)],
      absWorkingDir: root,
      bundle: true,
      minify: true,
      target: 'es2022',
      format: 'esm',
      platform: 'browser',
      external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
      define: { 'process.env.NODE_ENV': '"production"' },
      legalComments: 'none',
      alias,
      metafile: true,
      write: false,
      logLevel: 'error',
    })
    bytes = result.outputFiles[0].contents
    inputs = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
      .map(([input, { bytesInOutput }]) => [module(input), bytesInOutput])
      .filter(([, size]) => size > 0)
      .sort((a, b) => b[1] - a[1])
  }
  const size = brotli(bytes)
  const over = size > entry.budget
  failed ||= over
  const goal = entry.goal < entry.budget ? `, goal ${entry.goal}` : ''
  results.push({ name: entry.name, brotli: size, minified: bytes.length, budget: entry.budget, goal: entry.goal })
  console.log(`${over ? 'FAIL' : 'ok  '} ${entry.name}: ${size} B (budget ${entry.budget}${goal}; ${bytes.length} B minified)`)
  if (details) for (const [input, minified] of inputs.slice(0, 6)) console.log(`       ${String(minified).padStart(6)} B minified  ${input}`)
}
if (args.json) {
  const versions = Object.fromEntries(Object.keys(packages).map((name) => [`@lazy-ease/${name}`, manifestOf(name).version]))
  const report = { esbuild: version, target: 'es2022', format: 'esm', brotliQuality: 11, packed: Boolean(args.packed), versions, entries: results }
  writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`)
}
if (unpacked) rmSync(unpacked, { recursive: true, force: true })
if (failed) {
  console.error('Over budget. Shrink the entry, or get a budget change approved and update docs/design-spec.md.')
  process.exit(1)
}
