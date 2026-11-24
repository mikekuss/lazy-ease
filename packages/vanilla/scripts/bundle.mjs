// The esbuild settings of the self-starting scripts (core bundled in, minified
// ES2022 IIFE). scripts/build.mjs writes the published files with them, and
// apps/e2e/server.ts serves the same scripts from source.
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Builds a self-starting script: `src/auto.ts` (`lazy-ease.min.js`) or, with
 * `entry: 'auto-prepared'`, `lazy-ease.prepared.min.js`. `options` adds to or
 * overrides the published settings.
 */
export function buildScript({ entry = 'auto', ...options } = {}) {
  return build({
    entryPoints: [fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url))],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    // A page without a bundler has no `process`: core's development checks never run there.
    // `fades`: see withoutFades.
    define: { 'process.env.NODE_ENV': '"production"', fades: 'false' },
    legalComments: 'none',
    logLevel: 'warning',
    ...options,
    plugins: [withoutFades, ...(options.plugins ?? [])],
  })
}

/**
 * The markup API can neither enable a reveal, mark a placeholder
 * transparent nor keep an image for a new source (`keepImage`), so the
 * scripts build core's controller without its import of `fades`, which the
 * define above then makes `false`, and the minifier drops these paths. Not
 * a replaced module or a local constant: esbuild inlines those without
 * folding the code that depends on them. The ES modules keep all of them.
 */
const withoutFades = {
  name: 'lazy-ease-without-fades',
  setup(build) {
    build.onLoad({ filter: /[\\/]core[\\/](src|dist)[\\/]dom[\\/]controller\.(ts|js)$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const contents = source.replace(/^import \{ fades \} from '\.\/fades\.js';?$/m, '')
      if (contents === source) throw new Error(`${path} no longer imports fades from ./fades.js`)
      return { contents, loader: path.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(path) }
    })
  },
}
