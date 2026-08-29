import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '@/App'
import { ensureDefaultSettings } from '@/db/repositories/settings'
import '@/index.css'

// Pastikan baris pengaturan default ada sebelum render, supaya komponen yang
// mengamati pengaturan lewat useLiveQuery tidak pernah memicu penulisan di dalam
// transaksi read-only (ReadOnlyError) pada first run.
void ensureDefaultSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
})
