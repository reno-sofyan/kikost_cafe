import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('./package.json')

export default defineConfig({
  // Versi produk ditanam saat build supaya panel "Tentang" menyebut rilis nyata,
  // bukan angka yang harus diperbarui manual di dua tempat.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-48.png', 'apple-touch-icon.png', 'robots.txt', 'icons/*.png', 'brand/*.png', 'fonts/*.woff2'],
      manifest: {
        id: '/',
        name: 'Kione POS',
        short_name: 'Kione',
        description: 'Aplikasi kasir offline-first untuk kafe, restoran, dan ritel.',
        theme_color: '#4338ca',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // Halaman pesan-mandiri pelanggan (/order/*) & API selalu lewat jaringan —
        // jangan disajikan dari index.html yang ter-cache.
        navigateFallbackDenylist: [/^\/order\//, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
