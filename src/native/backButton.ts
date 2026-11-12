import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { closeTopModal } from '@/components/ui/modalStack'

/**
 * Tombol back Android: tutup modal/bottom sheet teratas dulu; bila tak ada, mundur
 * satu langkah di riwayat (transisi "kembali"); di layar awal, kecilkan aplikasi
 * (bukan keluar) supaya kasir tak kehilangan layar yang sedang dikerjakan.
 */
export function startBackButtonHandler(): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined
  const handle = App.addListener('backButton', ({ canGoBack }) => {
    if (closeTopModal()) return
    if (canGoBack) window.history.back()
    else void App.minimizeApp().catch(() => undefined)
  })
  return () => void handle.then((h) => h.remove())
}
