import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    // Fork per file (isolasi modul penuh: config cache, pool pg, dsb tak bocor
    // antar file) TAPI serial — file uji integrasi berbagi satu database uji.
    pool: 'forks',
    fileParallelism: false,
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
  },
})
