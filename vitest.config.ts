import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Konfigurasi vitest terpisah dari vite.config.ts supaya plugin PWA tidak ikut dimuat saat test.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    css: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/lib/**', 'src/sync/**', 'src/db/repositories/**'],
    },
  },
})
