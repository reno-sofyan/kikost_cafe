import { toast } from '@/state/toastStore'

/**
 * Jaring pengaman terakhir untuk error yang lolos dari try/catch manapun —
 * promise yang gagal tanpa `.catch()` (pola `onClick={() => void someAsyncFn()}`
 * dipakai di hampir semua tombol di app ini) dan error sinkron di luar render React
 * (ErrorBoundary React TIDAK menangkap keduanya).
 *
 * Kenapa ini penting di app ini secara khusus: WebView tablet tertentu (mis.
 * HarmonyOS 2.0 di Huawei MatePad SE) bisa jadi tidak mengimplementasikan sebuah
 * Web API yang diasumsikan ada (lihat kasus `crypto.randomUUID` — commit 725bb4c).
 * Tanpa jaring ini, error semacam itu di luar OnboardingWizard akan kembali diam-diam
 * membuat sebuah tombol/layar "macet" tanpa penjelasan, persis seperti kejadian itu
 * sebelum diperbaiki satu per satu. Ini bukan pengganti perbaikan akar masalah —
 * hanya memastikan masalah BERIKUTNYA (apa pun itu) langsung terlihat, bukan
 * ditemukan lewat laporan pengguna "aplikasinya diam saja".
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    console.error('[unhandled rejection]', reason)
    toast.error(`Terjadi kesalahan tak terduga: ${message}`, 8000)
  })

  window.addEventListener('error', (event) => {
    // Abaikan error resource (gambar/skrip gagal dimuat) — hanya minat pada error JS.
    if (event.error == null && event.message === 'Script error.') return
    const message = event.error instanceof Error ? event.error.message : event.message
    console.error('[uncaught error]', event.error ?? event.message)
    toast.error(`Terjadi kesalahan tak terduga: ${message}`, 8000)
  })
}
