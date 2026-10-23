import type { SalesReport } from '@/db/repositories/reports'
import type { PaymentMethod } from '@/types/domain'

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  platform: 'Aplikasi Online',
  deposit: 'Saldo Member',
  giftcard: 'Voucher Hadiah',
}

/**
 * Baris "Metode Pembayaran" di laporan: semua metode bayar yang tersedia di usaha
 * ini (urutan layar bayar, Rp0 bila belum dipakai), lalu metode lain yang tetap
 * punya transaksi di periode ini (mis. Kartu sebelum jenis usaha diganti).
 * Laporan khusus online hanya menampilkan metode yang ada datanya.
 */
export function paymentMethodRows(report: Pick<SalesReport, 'byPaymentMethod' | 'scope'>, methods: PaymentMethod[]): SalesReport['byPaymentMethod'] {
  if (report.scope === 'online') return report.byPaymentMethod
  const byMethod = new Map(report.byPaymentMethod.map((m) => [m.method, m]))
  const available = methods.map((method) => byMethod.get(method) ?? { method, amount: 0, count: 0 })
  const others = report.byPaymentMethod.filter((m) => !methods.includes(m.method))
  return [...available, ...others]
}
