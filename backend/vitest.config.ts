import { defineConfig } from 'vitest/config'

export default defineConfig({
  // PostCSS inline & kosong. Tanpa ini Vite (dipanggil vitest) menelusuri direktori
  // ke atas dari `backend/`, menemukan `postcss.config.js` root repo, lalu
  // `require('tailwindcss')` — dependency frontend yang TIDAK terpasang di
  // `backend/node_modules` pada CI — sehingga vitest crash saat startup.
  // Memberi config inline membuat Vite berhenti mencari sumber PostCSS lain.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    pool: 'threads',
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
  },
})
