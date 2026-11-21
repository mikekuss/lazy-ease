import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig, type Plugin } from 'vite'
import { prerender } from './scripts/prerender-plugin.js'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))
const demoDir = dirname(fileURLToPath(import.meta.url))
// The image server, SERVER_PORT as in server.ts.
const imageServer = `http://localhost:${Number(process.env.SERVER_PORT) || 3001}`

/** Answers /__identity with this checkout's demo directory, for `pnpm test:frames` (see /api/identity in server.ts). */
const identity = (): Plugin => ({
  name: 'lazy-ease-identity',
  configureServer(server) {
    server.middlewares.use('/__identity', (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ dir: demoDir }))
    })
  },
})

// `vite build --mode static` is the GitHub Pages build (see scripts/build-static.ts),
// `vite build --mode live` the build the demo server serves with `--serve`.
// Vite runs under tsx with the `source` condition (see package.json), so this
// config and the prerender plugin import the workspace packages' sources.
export default defineConfig(({ mode }) => ({
  plugins: [react(), prerender(), identity()],
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
        ...(mode === 'static' ? {} : { controller: page('controller.html'), placeholders: page('placeholders/index.html') }),
      },
    },
  },
  // Resolve workspace packages to their TypeScript sources, no build step needed.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/_img': imageServer,
      '/_meta': imageServer,
      '/api': imageServer,
      '/external': imageServer,
    },
  },
}))
