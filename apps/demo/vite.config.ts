import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Resolve workspace packages to their TypeScript sources, no build step needed.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    proxy: {
      '/_img': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
    },
  },
})
