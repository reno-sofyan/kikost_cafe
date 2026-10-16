import { defineConfig, devices } from '@playwright/test'

/**
 * Config e2e sinkronisasi: menjalankan frontend (vite preview) + backend nyata
 * (Postgres ephemeral). Berat — dijalankan terpisah:  npm run test:e2e:sync
 */
const WEB_PORT = 4173
const API_PORT = 8091
export const E2E_DEVICE_KEY = 'e2e-sync-key-abcdef0123456789'
/** Kunci perangkat tenant `kantin-e2e` — data spec kantin terpisah dari tenant `default`. */
export const E2E_KANTIN_DEVICE_KEY = 'e2e-kantin-key-abcdef0123456789'
export const E2E_KANTIN_TENANT = 'kantin-e2e'
/** Kunci perangkat tenant `multi-e2e` — spec dua tablet dalam satu usaha. */
export const E2E_MULTI_DEVICE_KEY = 'e2e-multi-key-abcdef0123456789'
/** Token konsol operator /ops — sama dengan default di tests/e2e/scripts/sync-backend.sh. */
export const E2E_OPS_TOKEN = 'e2e-ops-token-0123456789abcdef0123456789'
export const E2E_API_URL = `http://localhost:${API_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /sync\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1366, height: 768 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'sync', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: [
    {
      command: `npm run preview -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bash tests/e2e/scripts/sync-backend.sh',
      url: `${E2E_API_URL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
})
