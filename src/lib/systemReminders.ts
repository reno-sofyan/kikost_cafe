/**
 * Kapan notifikasi sistem Android dikirim (logika murni; pengirimnya src/native/systemNotify).
 * - Pesanan QR baru: hanya saat jumlah menunggu NAIK dan aplikasi di latar belakang
 *   (saat aplikasi terbuka, pil & suara di layar sudah memberi tahu).
 * - Stok menipis: hanya barang yang BARU masuk batas minimum selama aplikasi berjalan —
 *   stok yang memang sudah menipis saat aplikasi dibuka tak dikirim ulang tiap kali.
 */

export function qrOrderReminder(prevCount: number | null, count: number, appHidden: boolean): string | null {
  if (prevCount == null || count <= prevCount || !appHidden) return null
  return count === 1 ? '1 pesanan QR menunggu konfirmasi kasir.' : `${count} pesanan QR menunggu konfirmasi kasir.`
}

export interface StockItemRef {
  id: string
  name: string
}

/** Item yang baru menipis dibanding pengamatan sebelumnya (`prevIds` null = pengamatan pertama). */
export function newlyLowStock(prevIds: Set<string> | null, current: StockItemRef[]): StockItemRef[] {
  if (prevIds == null) return []
  return current.filter((i) => !prevIds.has(i.id))
}

export function lowStockMessage(items: StockItemRef[]): string {
  const names = items.slice(0, 3).map((i) => i.name)
  const more = items.length > 3 ? ` dan ${items.length - 3} lainnya` : ''
  return `Stok menipis: ${names.join(', ')}${more}. Cek Daftar Belanja / Stok.`
}
