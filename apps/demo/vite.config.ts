import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

// `vite build --mode static` is the GitHub Pages build (see scripts/build-static.ts).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'static' ? '/lazy-ease/' : '/',
  // Only the static build ships the throttling service worker.
  publicDir: mode === 'static' ? 'static' : false,
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
