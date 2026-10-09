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
        // Halaman pesan-mandiri pelanggan (/order/*), API, konsol operator (/ops)
        // & konsol Pemilik (/owner) — keduanya disajikan backend — selalu lewat
        // jaringan; jangan disajikan dari index.html yang ter-cache.
        navigateFallbackDenylist: [/^\/order\//, /^\/api\//, /^\/ops(\/|$)/, /^\/owner(\/|$)/],
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
    proxy: { '/api': 'http://localhost:8094' },
  },
  build: {
    // chrome87: WebView bawaan tablet murah (mis. Galaxy Tab A8, Android 11)
    // bisa tertinggal versi bila Play Store tak pernah memperbaruinya. es2022
    // meloloskan sintaks (class static block, dll.) yang baru ada di Chrome 94+.
    target: ['es2020', 'chrome87'],
    // Source map produksi TIDAK dibangkitkan sama sekali — sebelumnya `true`,
    // yang membuat seluruh source code (tak diminifikasi) bisa diambil siapa
    // pun yang tahu URL-nya, karena Dockerfile menyalin seluruh `dist/` apa
    // adanya ke nginx tanpa memfilter `*.map` (lihat juga blok penolakan
    // `*.map` di deploy/nginx/web.conf, sebagai lapisan jaga-jaga kedua bila
    // suatu saat sourcemap dibangkitkan lagi lewat jalur lain). Debug error
    // produksi tetap bisa dilakukan dengan rebuild lokal dari commit yang sama.
    sourcemap: false,
  },
})
