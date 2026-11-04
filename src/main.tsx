import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ToastHost } from '@/components/ui/ToastHost'
import { installGlobalErrorHandlers } from '@/lib/globalErrorHandler'
import { toast } from '@/state/toastStore'
import { cleanupLegacyBrand } from '@/lib/legacyCleanup'
import { ensurePersistentStorage } from '@/lib/persistentStorage'
import { menuTokenFromPath, preloadMenu } from '@/features/order/menuPreload'
import '@/index.css'

// Dipasang sebelum apa pun lain dirender — lihat globalErrorHandler.ts untuk alasannya.
installGlobalErrorHandlers()

/**
 * Pekerjaan startup khusus perangkat kasir — TIDAK dijalankan di halaman
 * pesan-mandiri (/order/*), yang dibuka di HP pelanggan lewat data seluler:
 * - service worker mem-precache seluruh aplikasi POS (beberapa MB);
 * - izin "persistent storage" & pembersihan IndexedDB lama tak relevan di sana.
 */
function startPosRuntime(): void {
  // Sisa IndexedDB/localStorage dari nama produk sebelum rebranding (Kikost Cafe POS /
  // Kinara Coffee) — tidak pernah berisi data produksi nyata, aman dihapus tanpa migrasi.
  // Tidak diblokir render: berjalan paralel, bukan prasyarat aplikasi tampil.
  void cleanupLegacyBrand()

  // Kunci IndexedDB sebagai "persistent storage" supaya Android tidak menghapusnya
  // otomatis saat perangkat kekurangan ruang. Tidak diblokir render — permintaan izin
  // boleh gagal/tertunda tanpa mencegah kasir memakai aplikasi. Lihat persistentStorage.ts.
  void ensurePersistentStorage()

  // Didaftarkan manual (injectRegister: false di vite.config.ts) supaya bisa dilewati
  // di halaman pelanggan. Isinya sama persis dengan registerSW.js yang dulu disuntikkan
  // plugin PWA.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () =>
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
        // Tablet kasir bisa terbuka berhari-hari tanpa dimuat ulang: cek versi baru tiap 30 menit.
        setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000)
      })
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register)
    watchForAppUpdate()
  }
}

/**
 * SW baru (skipWaiting + clientsClaim) langsung mengambil alih, tetapi halaman yang
 * sedang terbuka tetap menjalankan kode lama sampai dimuat ulang. Beri tahu pengguna
 * dengan toast yang menetap — sengaja TIDAK muat ulang otomatis supaya transaksi yang
 * sedang dikerjakan kasir tidak terpotong.
 */
function watchForAppUpdate(): void {
  // Kunjungan pertama (belum ada SW pengendali) bukan pembaruan — jangan tampilkan apa pun.
  if (!navigator.serviceWorker.controller) return
  let shown = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (shown) return
    shown = true
    toast.action('Versi baru Kione POS tersedia — ketuk untuk memuat ulang.', () => window.location.reload())
  })
}

const rootEl = document.getElementById('root')!

// Halaman pesan-mandiri pelanggan: publik, tanpa login, tanpa Dexie/sync.
// Dipisah dari aplikasi POS supaya HP pelanggan tidak memuat state kasir.
if (window.location.pathname.startsWith('/order/')) {
  // Halaman pelanggan dipakai di HP (potret) — matikan portrait-lock kasir.
  document.body.classList.add('customer-view')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff')
  const menuToken = menuTokenFromPath(window.location.pathname)
  if (menuToken) preloadMenu(menuToken)
  void import('@/features/order/CustomerApp').then(({ CustomerApp }) => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary scope="halaman pesanan">
          <BrowserRouter>
            <CustomerApp />
          </BrowserRouter>
          <ToastHost />
        </ErrorBoundary>
      </React.StrictMode>,
    )
  })
} else if (window.location.pathname.startsWith('/ulasan/')) {
  // Halaman ulasan tamu dari QR struk: publik, tanpa login/Dexie/sync — sama seperti /order/.
  document.body.classList.add('customer-view')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff')
  void Promise.all([import('@/features/review/ReviewApp'), import('@/features/review/reviewPath')]).then(([{ ReviewApp }, { reviewIdFromPath }]) => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary scope="halaman ulasan">
          <ReviewApp orderId={reviewIdFromPath(window.location.pathname)} />
        </ErrorBoundary>
      </React.StrictMode>,
    )
  })
} else if (window.location.pathname === '/absen' || window.location.pathname.startsWith('/absen/')) {
  // Absensi karyawan di HP sendiri: publik, tanpa login/Dexie/sync — sama seperti /order/.
  document.body.classList.add('customer-view')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff')
  void import('@/features/absen/AbsenApp').then(({ AbsenApp }) => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary scope="halaman absensi">
          <AbsenApp />
        </ErrorBoundary>
      </React.StrictMode>,
    )
  })
} else if (window.location.pathname.startsWith('/layar-pelanggan')) {
  // Layar pelanggan: jendela kedua di perangkat kasir. Hanya MEMBACA database lokal —
  // tanpa login, sinkronisasi, atau mesin cetak (semua itu tetap milik jendela kasir).
  document.body.classList.add('customer-view')
  startPosRuntime()
  void Promise.all([import('@/features/display/CustomerDisplayScreen'), import('@/db/repositories/settings')]).then(
    ([{ CustomerDisplayScreen }, { ensureDefaultSettings }]) =>
      ensureDefaultSettings().finally(() => {
        ReactDOM.createRoot(rootEl).render(
          <React.StrictMode>
            <ErrorBoundary scope="layar pelanggan">
              <CustomerDisplayScreen />
            </ErrorBoundary>
          </React.StrictMode>,
        )
      }),
  )
} else {
  startPosRuntime()
  void Promise.all([import('@/App'), import('@/db/repositories/settings')]).then(
    ([{ default: App }, { ensureDefaultSettings }]) =>
      // Pastikan baris pengaturan default ada sebelum render, supaya komponen yang
      // mengamati pengaturan lewat useLiveQuery tidak pernah memicu penulisan di dalam
      // transaksi read-only (ReadOnlyError) pada first run.
      ensureDefaultSettings().finally(() => {
        ReactDOM.createRoot(rootEl).render(
          <React.StrictMode>
            <ErrorBoundary scope="aplikasi">
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <ToastHost />
            </ErrorBoundary>
          </React.StrictMode>,
        )
      }),
  )
}
