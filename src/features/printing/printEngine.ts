import { processPrintQueue, warmUpStationPrinters } from '@/db/repositories/printQueue'
import type { PrinterStation } from '@/types/domain'

const ALL_STATIONS: PrinterStation[] = ['cashier', 'kitchen', 'bar']

/**
 * Menjalankan pemroses antrean cetak secara berkala — mencoba ulang job yang
 * gagal (backoff) tanpa menunggu aksi pengguna. Serupa dengan sync engine.
 * Saat aplikasi kembali ke depan (tablet dibangunkan / pindah dari aplikasi
 * lain), printer disambungkan lagi lebih awal supaya struk berikutnya tak
 * menunggu Bluetooth menyambung.
 */
export function startPrintEngine(): () => void {
  void processPrintQueue()
  void warmUpStationPrinters(ALL_STATIONS).catch(() => {})
  const handle = setInterval(() => void processPrintQueue(), 15_000)
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    void warmUpStationPrinters(ALL_STATIONS).catch(() => {})
    void processPrintQueue()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(handle)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
