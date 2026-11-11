import type { BillPaymentStatus, PaymentMethod } from '@/types/domain'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  platform: 'Aplikasi Online',
  deposit: 'Saldo Member',
  giftcard: 'Voucher Hadiah',
}

export const BILL_STATUS_LABELS: Record<BillPaymentStatus, string> = {
  UNPAID: 'Belum dibayar',
  PARTIALLY_PAID: 'Dibayar sebagian',
  PAID: 'Lunas',
  PARTIALLY_REFUNDED: 'Retur sebagian',
  REFUNDED: 'Diretur',
  VOIDED: 'Dibatalkan',
}
