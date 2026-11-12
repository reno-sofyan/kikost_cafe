import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { useUiPrefsStore } from '@/state/uiPrefsStore'

/**
 * Getar ringan saat tombol ditekan — hanya di aplikasi Android (di web dilewati) dan
 * hanya bila Pengaturan → Operasional → "Getar saat tombol ditekan" aktif. Tak pernah
 * melempar error: umpan balik tak boleh mengganggu transaksi.
 */
export function tapHaptic(): void {
  if (!Capacitor.isNativePlatform() || !useUiPrefsStore.getState().haptics) return
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined)
}
