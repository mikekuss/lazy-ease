// Typechecks the code examples in README.md and packages/*/README.md against
// the built packages. Run `pnpm build` first.
//
//   node scripts/check-examples.mjs
//
// Every ```ts, ```tsx, ```js and ```jsx block that imports from
// '@lazy-ease/...', or whose first line names a file (`// app/providers.tsx`),
// is a complete module and is checked. Other blocks are fragments and are
// skipped. To skip a complete-looking block on purpose, put this HTML comment
// on the line right before its opening fence (it does not render):
//
//   <!-- check-examples: skip -->
//
// Each README gets its own directory in a temp dir. A block that names a file
// is written to that path, so blocks of one README can import each other
// (`import { Providers } from './providers'`); the others are written to
// `block-L<line>.<ext>`. The directory gets a node_modules with links to the
// workspace packages and to the third-party packages the examples use, so
// '@lazy-ease/*' resolves through each package's exports to its dist types,
// as it does for an app. TypeScript 7 has no stable JS compiler API, so the
// workspace `tsc` checks a generated tsconfig (strict, jsx react-jsx,
// moduleResolution bundler, skipLibCheck, checkJs). `*.css` imports are
// declared as modules, as bundler client types do. Errors are reported as
// README path and line; the exit code is 1 on any error.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SKIP = '<!-- check-examples: skip -->'
const LANGS = { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx' }
const COMPLETE = /^\s*import\b[^'"]*['"]@lazy-ease\/|\bfrom\s+['"]@lazy-ease\//m
const NAMED = /^\/\/\s*([\w./-]+\.(?:tsx?|jsx?|mjs))\s*$/

// Third-party packages the examples import, and the workspace directories whose node_modules have them.
const THIRD_PARTY = ['react', 'react-dom', '@types/react', '@types/react-dom', '@types/node', 'hono', '@hono/node-server', 'thumbhash']
const SEARCH = ['packages/react', 'packages/server', 'packages/core', 'packages/vanilla', 'apps/demo', '.']

const readmes = [
  'README.md',
  ...readdirSync(join(root, 'packages'))
    .map((name) => `packages/${name}/README.md`)
    .filter((file) => existsSync(join(root, file))),
]

for (const name of readdirSync(join(root, 'packages'))) {
  const pkg = join(root, 'packages', name, 'package.json')
  if (!existsSync(pkg)) continue
  const exports = JSON.parse(readFileSync(pkg, 'utf8')).exports ?? {}
  for (const entry of Object.values(exports)) {
    const types = typeof entry === 'object' ? entry.types : undefined
    if (types && !existsSync(join(root, 'packages', name, types))) {
      console.error(`packages/${name}: ${types} is missing. Run \`pnpm build\` first.`)
      process.exit(1)
    }
  }
}

/** The fenced blocks of a Markdown file with their opening fence line (1-based). */
function blocks(file) {
  const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/)
  const found = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,})(\w*)/.exec(lines[i])
    if (!open) continue
    const [, , fence, lang] = open
    let end = i + 1
    while (end < lines.length && !lines[end].trimStart().startsWith(fence)) end++
    found.push({ file, line: i + 1, lang, code: lines.slice(i + 1, end), skip: lines[i - 1]?.trim() === SKIP })
    i = end
  }
  return found
}

const work = mkdtempSync(join(tmpdir(), 'lazy-ease-examples-'))
const modules = join(work, 'node_modules')

function link(name, target) {
  const path = join(modules, ...name.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

const sources = new Map()
let checked = 0
let skipped = 0
try {
  for (const name of readdirSync(join(root, 'packages'))) {
    if (existsSync(join(root, 'packages', name, 'package.json'))) link(`@lazy-ease/${name}`, join(root, 'packages', name))
  }
  for (const name of THIRD_PARTY) {
    const base = SEARCH.find((dir) => existsSync(join(root, dir, 'node_modules', name)))
    if (!base) throw new Error(`${name} is not installed in the workspace. Run \`pnpm install\`.`)
    link(name, realpathSync(join(root, base, 'node_modules', name)))
  }

  const files = []
  for (const readme of readmes) {
    const dir = join(work, readme.replace(/\/?README\.md$/, '').replace(/\//g, '_') || 'root')
    const taken = new Set()
    for (const block of blocks(readme)) {
      const ext = LANGS[block.lang]
      if (!ext) continue
      const code = block.code.join('\n')
      const named = NAMED.exec(block.code[0] ?? '')?.[1]
      if (block.skip || !(COMPLETE.test(code) || (named && /^\s*(import|export)\b/m.test(code)))) {
        skipped++
        continue
      }
      const name = named ?? `block-L${block.line}.${ext}`
      if (taken.has(name)) throw new Error(`${readme}:${block.line}: a second block names ${name}`)
      taken.add(name)
      const path = join(dir, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, code + '\n')
      sources.set(resolve(path), block)
      files.push(relative(work, path).split(sep).join('/'))
      checked++
    }
  }

  writeFileSync(join(work, 'globals.d.ts'), "declare module '*.css'\n")
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          lib: ['es2023', 'dom', 'dom.iterable'],
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          allowJs: true,
          checkJs: true,
          resolveJsonModule: true,
          isolatedModules: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['node'],
        },
        files: ['globals.d.ts', ...files],
      },
      null,
      2,
    ),
  )

  let output = ''
  try {
    execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(work, 'tsconfig.json'), '--pretty', 'false'], {
      cwd: work,
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (!output.trim()) throw error
  }

  const errors = output.split(/\r?\n/).filter((line) => line.trim())
  for (const line of errors) {
    const match = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(line)
    const block = match && sources.get(resolve(work, match[1]))
    if (block) {
      console.error(`${block.file}:${block.line + +match[2]}:${match[3]} (${block.lang} block at line ${block.line}): ${match[4]}`)
    } else {
      console.error(line)
    }
  }
  if (errors.length) {
    console.error(`\ncheck-examples: ${checked} blocks checked, ${skipped} skipped, type errors above.`)
    process.exitCode = 1
  } else {
    console.log(`check-examples: ${checked} blocks checked, ${skipped} skipped, no type errors.`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
