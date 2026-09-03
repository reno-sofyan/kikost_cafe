import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@/index.css'

const rootEl = document.getElementById('root')!

// Halaman pesan-mandiri pelanggan: publik, tanpa login, tanpa Dexie/sync.
// Dipisah dari aplikasi POS supaya HP pelanggan tidak memuat state kasir.
if (window.location.pathname.startsWith('/order/')) {
  void import('@/features/order/CustomerApp').then(({ CustomerApp }) => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <BrowserRouter>
          <CustomerApp />
        </BrowserRouter>
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
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </React.StrictMode>,
        )
      }),
  )
}
