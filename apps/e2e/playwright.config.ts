import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT) || 3100
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'tests',
  // Refuses a server that another checkout started on this port.
  globalSetup: './identity.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Explicit DPR 1 and a fixed viewport in every engine; tests that need
  // another DPR set it themselves.
  use: { baseURL, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  webServer: {
    command: 'pnpm serve',
    url: `${baseURL}/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    // The first start generates the source images.
    timeout: 120_000,
  },
})
