import type { StockMovementReason } from '@/types/domain'

export const STOCK_REASON_LABELS: Record<StockMovementReason, string> = {
  sale: 'Penjualan',
  return: 'Retur',
  adjustment: 'Penyesuaian',
  waste: 'Waste',
  stock_in: 'Stok Masuk',
  stock_out: 'Stok Keluar',
  initial: 'Awal',
  purchase_receipt: 'Penerimaan Pembelian',
  transfer_in: 'Transfer Masuk',
  transfer_out: 'Transfer Keluar',
  stock_opname: 'Stok Opname',
  production_consumption: 'Konsumsi Produksi',
  production_output: 'Hasil Produksi',
  supplier_return: 'Retur ke Pemasok',
}
