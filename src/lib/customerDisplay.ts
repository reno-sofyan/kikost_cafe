/**
 * Layar pelanggan: kasir mengumumkan pesanan yang sedang dikerjakan lewat
 * localStorage; jendela kedua di perangkat yang sama membacanya (event `storage`)
 * lalu mengambil isi pesanan langsung dari database lokal.
 */
export const CUSTOMER_DISPLAY_KEY = 'kione.customerDisplay'
export const CUSTOMER_DISPLAY_PATH = '/layar-pelanggan'
/** Penunjuk lebih tua dari ini dianggap basi (kasir sudah ditutup/berpindah layar). */
export const CUSTOMER_DISPLAY_STALE_MS = 6 * 60 * 60 * 1000

export type CustomerDisplayStage = 'order' | 'payment' | 'qris' | 'paid'

export interface CustomerDisplayPointer {
  orderId: string | null
  stage: CustomerDisplayStage
  /** Jumlah yang sedang ditagih lewat QRIS (tahap `qris`). */
  amount?: number
  at: number
}

export function publishCustomerDisplay(pointer: Omit<CustomerDisplayPointer, 'at'>): void {
  try {
    localStorage.setItem(CUSTOMER_DISPLAY_KEY, JSON.stringify({ ...pointer, at: Date.now() }))
  } catch {
    // Penyimpanan penuh/terblokir: layar pelanggan sekadar tak ikut berubah.
  }
}

export function readCustomerDisplay(raw?: string | null): CustomerDisplayPointer | null {
  try {
    const value = raw === undefined ? localStorage.getItem(CUSTOMER_DISPLAY_KEY) : raw
    if (!value) return null
    const p = JSON.parse(value) as Partial<CustomerDisplayPointer>
    if (typeof p.at !== 'number' || (p.orderId != null && typeof p.orderId !== 'string')) return null
    const stage: CustomerDisplayStage = p.stage === 'payment' || p.stage === 'qris' || p.stage === 'paid' ? p.stage : 'order'
    return { orderId: p.orderId ?? null, stage, amount: typeof p.amount === 'number' ? p.amount : undefined, at: p.at }
  } catch {
    return null
  }
}

/** Pesanan yang ditampilkan: penunjuk kasir bila masih segar, selain itu tak ada. */
export function activeCustomerDisplay(pointer: CustomerDisplayPointer | null, now: number): CustomerDisplayPointer | null {
  if (!pointer || !pointer.orderId) return null
  return now - pointer.at <= CUSTOMER_DISPLAY_STALE_MS ? pointer : null
}
