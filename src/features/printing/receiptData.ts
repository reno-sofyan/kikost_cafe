import { db } from '@/db/schema'
import { formatDateTime } from '@/lib/datetime'
import { businessDisplayName } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { onlineChannelLabel } from '@/lib/onlineOrders'
import type { AppSettings, Order, OrderItem, Payment } from '@/types/domain'

export interface ReceiptLine {
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  modifierLines: string[]
  note: string | null
}

export interface ReceiptData {
  businessName: string
  address: string
  phone: string
  logoDataUrl: string | null
  paperSize: '58mm' | '80mm'
  orderNumber: string
  cashierName: string
  createdAtLabel: string
  /** `null` bila jenis usaha hanya punya satu jenis pesanan (mis. minimarket). */
  orderTypeLabel: string | null
  tableLabel: string | null
  queueLabel: string | null
  customerNote: string | null
  isReprint: boolean
  lines: ReceiptLine[]
  subtotal: number
  discountAmount: number
  taxPercent: number
  taxAmount: number
  serviceChargePercent: number
  serviceChargeAmount: number
  roundingAdjustment: number
  grandTotal: number
  payments: { methodLabel: string; amount: number; receivedAmount: number | null; changeAmount: number | null; tipAmount?: number }[]
  footerNote: string
  isVoided: boolean
  /** Tagihan sementara (pre-bill): dicetak SEBELUM dibayar — tanpa rincian pembayaran. */
  isPreBill?: boolean
  /** Pelayan yang melayani (bila dicatat). */
  waiterName?: string | null
  guestCount?: number | null
  /** Total tip dari semua pembayaran (0/undefined = tak ditampilkan). */
  tipTotal?: number
  /** Kanal pesanan online, mis. "GoFood #F-123". */
  onlineChannel?: string | null
}

const ORDER_TYPE_LABELS: Record<Order['type'], string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Online',
}

const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  platform: 'Aplikasi Online',
}

export function buildSampleReceiptData(settings: AppSettings): ReceiptData {
  return {
    businessName: businessDisplayName(settings),
    address: settings.address,
    phone: settings.phone,
    logoDataUrl: settings.logoDataUrl,
    paperSize: settings.receiptPaperSize,
    orderNumber: `${settings.transactionPrefix}-00000`,
    cashierName: 'Uji Cetak',
    createdAtLabel: formatDateTime(Date.now()),
    orderTypeLabel: 'Dine-in',
    tableLabel: null,
    queueLabel: 'Antrean #12',
    customerNote: 'Budi',
    isReprint: false,
    lines: [
      { name: 'Kopi Susu Gula Aren', qty: 2, unitPrice: 22000, lineTotal: 44000, modifierLines: ['  Ukuran: Regular'], note: null },
      { name: 'Nasi Goreng Spesial', qty: 1, unitPrice: 28000, lineTotal: 28000, modifierLines: [], note: 'Tidak pedas' },
    ],
    subtotal: 72000,
    discountAmount: 0,
    taxPercent: settings.taxPercent,
    taxAmount: Math.round((72000 * settings.taxPercent) / 100),
    serviceChargePercent: settings.serviceChargePercent,
    serviceChargeAmount: Math.round((72000 * settings.serviceChargePercent) / 100),
    roundingAdjustment: 0,
    grandTotal: 72000,
    payments: [{ methodLabel: 'Tunai', amount: 72000, receivedAmount: 75000, changeAmount: 3000 }],
    footerNote: settings.receiptFooterNote,
    isVoided: false,
  }
}

export async function buildReceiptData(
  order: Order,
  settings: AppSettings,
  opts: { isReprint?: boolean; preBill?: boolean } = {},
): Promise<ReceiptData> {
  const items = await db.orderItems.where('orderId').equals(order.id).toArray()
  const payments = await db.payments.where('orderId').equals(order.id).toArray()
  const table = order.tableId ? await db.cafeTables.get(order.tableId) : undefined
  const features = featuresForBusinessType(settings.businessType)

  const lines: ReceiptLine[] = items
    .filter((item) => !item.voided && !item.removed)
    .map((item: OrderItem) => ({
      name: item.productName,
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      modifierLines: item.modifiers.map((m) => `  ${m.groupName}: ${m.optionName}${m.priceDelta > 0 ? ` (+${m.priceDelta})` : ''}`),
      note: item.notes || null,
    }))

  return {
    businessName: businessDisplayName(settings),
    address: settings.address,
    phone: settings.phone,
    logoDataUrl: settings.logoDataUrl,
    paperSize: settings.receiptPaperSize,
    orderNumber: order.orderNumber,
    cashierName: order.cashierName,
    createdAtLabel: formatDateTime(opts.preBill ? Date.now() : (order.paidAt ?? order.createdAt)),
    orderTypeLabel: features.orderTypes.length > 1 || table ? ORDER_TYPE_LABELS[order.type] : null,
    tableLabel: table ? table.name : null,
    queueLabel: features.queueNumbers && order.queueNumber ? `Antrean #${order.queueNumber}` : null,
    customerNote: order.notes.trim() || null,
    isReprint: opts.isReprint ?? false,
    lines,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    taxPercent: order.taxPercent,
    taxAmount: order.taxAmount,
    serviceChargePercent: order.serviceChargePercent,
    serviceChargeAmount: order.serviceChargeAmount,
    roundingAdjustment: order.roundingAdjustment,
    grandTotal: order.grandTotal,
    // Tagihan sementara tak memuat pembayaran — kecuali yang SUDAH masuk (bayar sebagian).
    payments: payments
      .filter((p) => !opts.preBill || p.amount > 0)
      .map((p) => ({
        methodLabel: PAYMENT_METHOD_LABELS[p.method],
        amount: p.amount,
        receivedAmount: p.receivedAmount,
        changeAmount: p.changeAmount,
        tipAmount: p.tipAmount || undefined,
      })),
    footerNote: settings.receiptFooterNote,
    isVoided: order.status === 'void',
    isPreBill: opts.preBill ?? false,
    waiterName: order.waiterName?.trim() || null,
    onlineChannel: onlineChannelLabel(order) || null,
    guestCount: order.type === 'dine_in' ? order.guestCount : null,
    tipTotal: payments.filter((p) => p.amount > 0).reduce((s, p) => s + (p.tipAmount ?? 0), 0),
  }
}
