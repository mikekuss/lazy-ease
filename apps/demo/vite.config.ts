import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'
import { prerender } from './scripts/prerender-plugin.js'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

// `vite build --mode static` is the GitHub Pages build (see scripts/build-static.ts),
// `vite build --mode live` the build the demo server serves with `--serve`.
// Vite runs under tsx with the `source` condition (see package.json), so this
// config and the prerender plugin import the workspace packages' sources.
export default defineConfig(({ mode }) => ({
  plugins: [react(), prerender()],
  base: mode === 'static' ? '/lazy-ease/' : '/',
  // Only the static build ships the throttling service worker.
  publicDir: mode === 'static' ? 'static' : false,
  build: {
    outDir: mode === 'live' ? 'dist-live' : 'dist',
    rollupOptions: {
      input: {
        index: page('index.html'),
        fade: page('fade/index.html'),
        lcp: page('lcp/index.html'),
        recipes: page('recipes/index.html'),
        // The controller cases need the demo server.
        ...(mode === 'static' ? {} : { controller: page('controller.html') }),
      },
    },
  },
  // Resolve workspace packages to their TypeScript sources, no build step needed.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/_img': 'http://localhost:3001',
      '/_meta': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
      '/external': 'http://localhost:3001',
    },
  },
}))
