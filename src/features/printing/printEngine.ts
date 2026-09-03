import { processPrintQueue } from '@/db/repositories/printQueue'

/**
 * Menjalankan pemroses antrean cetak secara berkala — mencoba ulang job yang
 * gagal (backoff) tanpa menunggu aksi pengguna. Serupa dengan sync engine.
 */
export function startPrintEngine(): () => void {
  void processPrintQueue()
  const handle = setInterval(() => void processPrintQueue(), 15_000)
  return () => clearInterval(handle)
}
