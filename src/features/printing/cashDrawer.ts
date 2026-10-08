import { activePrinterForStation } from '@/db/repositories/printers'
import { getSettings } from '@/db/repositories/settings'
import { buildEscPosDrawerKick } from '@/features/printing/escpos'
import { PrinterNotConfiguredError, sendEscPosBytes } from '@/features/printing/printerDrivers'
import type { PaymentMethod } from '@/types/domain'

export class DrawerNeedsEscPosPrinterError extends Error {
  constructor() {
    super('Laci kasir hanya bisa dibuka lewat printer kasir Bluetooth/LAN (bukan cetak lewat browser).')
    this.name = 'DrawerNeedsEscPosPrinterError'
  }
}

/**
 * Membuka laci kasir: laci elektrik dicolok (kabel RJ11) ke printer kasir aktif,
 * jadi aplikasi cukup mengirim pulsa ESC/POS ke printer itu. Langsung dikirim —
 * BUKAN lewat antrean cetak, supaya laci tak tiba-tiba terbuka belakangan saat
 * antrean mencoba ulang.
 */
export async function openCashDrawer(): Promise<void> {
  const printer = await activePrinterForStation('cashier')
  if (!printer) throw new PrinterNotConfiguredError()
  if (printer.connectionType === 'browser') throw new DrawerNeedsEscPosPrinterError()
  await sendEscPosBytes(printer, buildEscPosDrawerKick())
}

/**
 * Dipanggil oleh layar pembayaran kasir setelah pembayaran tersimpan (bukan dari
 * repositori — pembayaran yang masuk lewat sinkronisasi tak boleh membuka laci).
 * Tak ditunggu & tak pernah melempar: gagal buka laci tak membatalkan pembayaran.
 */
export function openCashDrawerForPayment(methods: PaymentMethod[]): void {
  if (!methods.includes('cash')) return
  void (async () => {
    const settings = await getSettings()
    if (settings.printerConfig.openDrawerOnCash === false) return
    await openCashDrawer()
  })().catch(() => {})
}
