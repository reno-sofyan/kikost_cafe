import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    // `threads` (bukan `forks`) — hindari child_process fork sepenuhnya; lebih
    // tahan di runner CI. `singleThread` + `fileParallelism:false` menjaga file
    // uji integrasi mengakses satu database uji secara serial.
    pool: 'threads',
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
  },
})
