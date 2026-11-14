// Measures each public entry against its budget: esbuild (the version pinned
// in packages/vanilla), ES2022 ESM, minified, production define, React peers
// external, Brotli quality 11. The entries are the fixtures in scripts/sizes;
// the IIFE and the stylesheet are the published files. Run `pnpm build` first.
//
//   pnpm check:sizes            fails when an entry is over its budget
//   pnpm check:sizes --details  also lists each entry's largest inputs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { build, version } = createRequire(path.join(root, 'packages/vanilla/package.json'))('esbuild')

// Approved 0.3 budgets, in Brotli bytes; `goal` is the target of the size pass after 0.3 (docs/design-spec.md).
const ENTRIES = [
  { name: 'createLoader', fixture: 'create-loader.js', budget: 1000, goal: 1000 },
  { name: 'attach (with controller)', fixture: 'attach.js', budget: 5400, goal: 3500 },
  { name: 'enhance (with controller)', fixture: 'enhance.js', budget: 6000, goal: 4000 },
  { name: 'IIFE lazy-ease.min.js', file: 'packages/vanilla/dist/lazy-ease.min.js', budget: 6600, goal: 4500 },
  { name: 'CSS lazy-ease.css', file: 'packages/vanilla/dist/lazy-ease.css', budget: 500, goal: 500 },
  { name: 'React Image', fixture: 'image.js', budget: 7900, goal: 5000 },
]

// The workspace packages as a consumer imports them: their published `exports` entry, from dist.
const alias = Object.fromEntries(
  ['core', 'vanilla', 'react'].map((name) => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'))
    return [manifest.name, path.join(root, 'packages', name, manifest.exports['.'].default)]
  }),
)
const brotli = (bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const details = process.argv.includes('--details')
const module = (input) => input.replace(/^.*?packages\//, '').replace(/^.*node_modules\//, '')

console.log(`esbuild ${version}, ES2022 ESM, minified, production, Brotli 11`)
let failed = false
for (const entry of ENTRIES) {
  let bytes
  let inputs = []
  if (entry.file) bytes = readFileSync(path.join(root, entry.file))
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
  console.log(`${over ? 'FAIL' : 'ok  '} ${entry.name}: ${size} B (budget ${entry.budget}${goal}; ${bytes.length} B minified)`)
  if (details) for (const [input, minified] of inputs.slice(0, 6)) console.log(`       ${String(minified).padStart(6)} B minified  ${input}`)
}
if (failed) {
  console.error('Over budget. Shrink the entry, or get a budget change approved and update docs/design-spec.md.')
  process.exit(1)
}
