import { defineConfig, devices } from '@playwright/test'

/**
 * E2E Kikost Cafe POS. Menjalankan build produksi lewat `vite preview`
 * agar service worker & PWA aktif (mendekati kondisi tablet).
 *
 *   npm run build && npm run test:e2e
 */
const PORT = 4173
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Tablet 10-13", landscape, mirip target 1366x768.
    viewport: { width: 1366, height: 768 },
  },
  projects: [
    {
      name: 'tablet-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
})
