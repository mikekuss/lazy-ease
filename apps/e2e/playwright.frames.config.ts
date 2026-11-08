import { defineConfig } from '@playwright/test'

// The opt-in pixel frame test for the controller case page (apps/demo/controller.html).
// Run it with `pnpm test:frames`. It is not part of `pnpm e2e` or CI: the default
// config only looks in tests/, this one only in frames/.
const PORT = 5173
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'frames',
  // One page records at a time, so the cases don't compete for the CPU while they are filmed.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/frames', open: 'never' }]],
  outputDir: 'test-results/frames',
  timeout: 300_000,
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: {
    // The demo's dev script: Vite on 5173 and the image server on 3001.
    command: 'pnpm --dir ../demo dev',
    // Proxied to the image server, so this only answers once both are up
    // (the first start generates the images).
    url: `${baseURL}/api/images`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
