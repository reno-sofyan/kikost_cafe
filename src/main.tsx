import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ToastHost } from '@/components/ui/ToastHost'
import { installGlobalErrorHandlers } from '@/lib/globalErrorHandler'
import { cleanupLegacyBrand } from '@/lib/legacyCleanup'
import { ensurePersistentStorage } from '@/lib/persistentStorage'
import '@/index.css'

// Dipasang sebelum apa pun lain dirender — lihat globalErrorHandler.ts untuk alasannya.
installGlobalErrorHandlers()

// Sisa IndexedDB/localStorage dari nama produk sebelum rebranding (Kikost Cafe POS /
// Kinara Coffee) — tidak pernah berisi data produksi nyata, aman dihapus tanpa migrasi.
// Tidak diblokir render: berjalan paralel, bukan prasyarat aplikasi tampil.
void cleanupLegacyBrand()

// Kunci IndexedDB sebagai "persistent storage" supaya Android tidak menghapusnya
// otomatis saat perangkat kekurangan ruang. Tidak diblokir render — permintaan izin
// boleh gagal/tertunda tanpa mencegah kasir memakai aplikasi. Lihat persistentStorage.ts.
void ensurePersistentStorage()

const rootEl = document.getElementById('root')!

// Halaman pesan-mandiri pelanggan: publik, tanpa login, tanpa Dexie/sync.
// Dipisah dari aplikasi POS supaya HP pelanggan tidak memuat state kasir.
if (window.location.pathname.startsWith('/order/')) {
  // Halaman pelanggan dipakai di HP (potret) — matikan portrait-lock kasir.
  document.body.classList.add('customer-view')
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
} else {
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
