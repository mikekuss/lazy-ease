// Builds a minimal Next.js App Router app against the packed @lazy-ease/react,
// @lazy-ease/core and @lazy-ease/testing tarballs, installed with npm in a temporary folder, and checks the
// prerendered HTML. Catches a lost 'use client' directive, a broken export and
// server-rendered styles that don't reach the HTML.
// Run `pnpm build && pnpm check:packages` first; it leaves the tarballs in .cache/packs.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Pinned on purpose: bump them deliberately, not by accident.
const NEXT = '16.4.5'
const REACT = '19.3.1'

const root = resolve(import.meta.dirname, '..')
const packDir = join(root, '.cache', 'packs')
const packed = (name) => existsSync(packDir) && readdirSync(packDir).find((file) => file.startsWith(`lazy-ease-${name}-`) && file.endsWith('.tgz'))
const tarball = packed('react')
const coreTarball = packed('core')
const testingTarball = packed('testing')
if (!tarball || !coreTarball || !testingTarball) {
  console.error('No @lazy-ease/react, @lazy-ease/core or @lazy-ease/testing tarball in .cache/packs. Run `pnpm build && pnpm check:packages` first.')
  process.exit(1)
}
const fileSpec = (file) => `file:${join(packDir, file).replaceAll('\\', '/')}`

// NEXT_SMOKE_DIR keeps the app between runs (CI caches it); otherwise a fresh temp folder.
const keep = Boolean(process.env.NEXT_SMOKE_DIR)
const app = keep ? resolve(process.env.NEXT_SMOKE_DIR) : mkdtempSync(join(tmpdir(), 'lazy-ease-next-'))
console.log(`Next.js smoke app in ${app}`)

const files = {
  'package.json': JSON.stringify(
    {
      name: 'lazy-ease-next-smoke',
      private: true,
      dependencies: {
        '@lazy-ease/core': fileSpec(coreTarball),
        '@lazy-ease/react': fileSpec(tarball),
        '@lazy-ease/testing': fileSpec(testingTarball),
        next: NEXT,
        react: REACT,
        'react-dom': REACT,
      },
      // @lazy-ease/react depends on the core version it was packed with; use the local tarball.
      overrides: { '@lazy-ease/core': '$@lazy-ease/core' },
    },
    null,
    2,
  ),

  'next.config.mjs': `export default {}\n`,

  // A Server Component.
  'app/layout.jsx': `
import { Providers } from './providers'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
`,

  // A custom loader holds functions, so it lives in a client file.
  'app/providers.jsx': `'use client'
import { LazyEaseProvider } from '@lazy-ease/react'

const loader = {
  url: ({ src, width, aspectRatio, focalPoint, format, quality }) =>
    \`/custom-loader\${src}?w=\${width}&ar=\${aspectRatio ?? ''}&fx=\${focalPoint?.x ?? ''}&fmt=\${format}&q=\${quality}\`,
  widths: [320, 640, 1280, 1600],
  qualities: [75],
  formats: ['webp'],
}

export function Providers({ children }) {
  return <LazyEaseProvider loader={loader}>{children}</LazyEaseProvider>
}
`,

  // A Server Component that imports <Image> and the plain functions directly.
  'app/page.jsx': `
import { Image, createLoader, DEFAULT_WIDTHS } from '@lazy-ease/react'
import { candidateSet, createLazyEase } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { casesOf } from '@lazy-ease/testing'

// Both core entry points import on the server: the controller module does nothing until attach.
const candidates = candidateSet({ src: '/strip.jpg', widths: [256, 384, 640], srcWidth: 2000, srcHeight: 300, aspectRatio: 1, quality: 75, format: 'webp', loader: createLoader() })
const decode = thumbhashDecoder({ thumbHashToAverageRGBA: () => ({ r: 0, g: 0.5, b: 1, a: 1 }), thumbHashToDataURL: () => '' })
const thumbhashColor = decode('1QcSHQRnh493V4dIh4eXh1h4kJUI').style.backgroundColor

const reference = createLoader({ baseUrl: '/_img' })

// The fixture JSON goes through the bundler's JSON modules; core writes each URL.
const fixtureUrls = casesOf('urls', 'url', { skipTopics: ['nfc', 'token'] })
const fixtureMismatches = fixtureUrls
  .filter(({ input, expected }) => createLoader(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }).url(input.request) !== expected.url)
  .map(({ id }) => id)

export default function Page() {
  const url = reference.url({ src: '/a.jpg', width: DEFAULT_WIDTHS[0], quality: 75, format: 'webp' })
  return (
    <main>
      <p id="reference-url">{url}</p>
      <p id="core-entries">{\`controller: \${typeof createLazyEase}; candidates: \${candidates.srcset}; thumbhash: \${thumbhashColor}\`}</p>
      <p id="fixture-urls">{[\`fixture URLs: \${fixtureUrls.length - fixtureMismatches.length} of \${fixtureUrls.length} match\`, ...fixtureMismatches].join(' ')}</p>
      <div style={{ position: 'relative', width: '100%', height: 400 }}>
        <Image
          src="/banner.jpg"
          alt="Banner"
          fill
          sizes="100vw"
          priority
          srcWidth={1600}
          srcHeight={500}
          focalPoint={{ x: 70, y: 60 }}
        />
      </div>
    </main>
  )
}
`,
}

for (const [path, content] of Object.entries(files)) {
  const file = join(app, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content.trimStart())
}

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
function run(args, { shell = false } = {}) {
  console.log(`$ ${args.join(' ')}`)
  const result = spawnSync(args[0], args.slice(1), { cwd: app, stdio: 'inherit', env, shell })
  if (result.status !== 0) {
    console.error(`✗ ${args.join(' ')} failed`)
    process.exit(1)
  }
}

// The tarball's contents change between builds while its name stays, so npm
// must not reuse an earlier install of it.
rmSync(join(app, 'node_modules', '@lazy-ease'), { recursive: true, force: true })
rmSync(join(app, 'package-lock.json'), { force: true })
// npm's own script next to node, so Windows needs no shell for npm.cmd.
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const npm = existsSync(npmCli) ? [process.execPath, npmCli] : ['npm']
run([...npm, 'install', '--no-audit', '--no-fund', '--loglevel=error'], { shell: !existsSync(npmCli) && process.platform === 'win32' })
run([process.execPath, join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'])

const htmlFile = join(app, '.next', 'server', 'app', 'index.html')
if (!existsSync(htmlFile)) {
  console.error('✗ / was not prerendered to .next/server/app/index.html')
  process.exit(1)
}
const html = readFileSync(htmlFile, 'utf8')
const expectations = [
  ['the focal-point size container', 'container-type:size'],
  ['the focal-point object-position', 'object-position:clamp('],
  ['a URL from the provider loader', '/custom-loader/banner.jpg?w='],
  ['the createLoader() URL', '/_img/a.jpg?fmt=webp&amp;q=75&amp;w='],
  [
    'both core entry points',
    'controller: function; candidates: /_img/strip.jpg?ar=1&amp;fmt=webp&amp;q=75&amp;w=256 256w, /_img/strip.jpg?ar=1&amp;fmt=webp&amp;q=75&amp;w=384 300w; thumbhash: #0080ff',
  ],
]
// Every non-pending URL record of @lazy-ease/testing, reproduced inside the Next build.
const testingDir = join(root, 'packages', 'testing')
const urlCases = JSON.parse(readFileSync(join(testingDir, 'fixtures', 'urls.json'), 'utf8')).cases.filter(
  (c) => c.op === 'url' && !(c.topics ?? []).some((t) => t === 'nfc' || t === 'token'),
)
expectations.push(['every fixture URL from core', `fixture URLs: ${urlCases.length} of ${urlCases.length} match</p>`])
let failures = 0
for (const [what, needle] of expectations) {
  if (html.includes(needle)) console.log(`✓ HTML has ${what}`)
  else {
    failures++
    console.error(`✗ HTML lacks ${what} (${needle})`)
  }
}

if (!keep) rmSync(app, { recursive: true, force: true })
if (failures) process.exit(1)
console.log('Next.js smoke build passed')
