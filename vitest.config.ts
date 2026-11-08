import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Tests run against workspace sources, so core needs no build first.
  resolve: {
    alias: { '@lazy-ease/core': fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)) },
  },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          include: ['packages/*/test/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['packages/react/test/setup-dom.ts'],
        },
      },
    ],
  },
})
