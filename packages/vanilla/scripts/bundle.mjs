// The esbuild settings of the self-starting script (core bundled in, minified
// ES2022 IIFE). scripts/build.mjs writes the published file with them, and
// apps/e2e/server.ts serves the same script from source.
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/** Builds the self-starting script; `options` adds to or overrides the published settings. */
export function buildScript(options = {}) {
  return build({
    entryPoints: [fileURLToPath(new URL('../src/auto.ts', import.meta.url))],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'warning',
    ...options,
  })
}
