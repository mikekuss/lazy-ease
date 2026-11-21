// The esbuild settings of the self-starting scripts (core bundled in, minified
// ES2022 IIFE). scripts/build.mjs writes the published files with them, and
// apps/e2e/server.ts serves the same scripts from source.
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
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'warning',
    ...options,
  })
}
