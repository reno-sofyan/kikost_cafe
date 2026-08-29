import { db } from '@/db/schema'
import { formatDateTime } from '@/lib/datetime'
import type { CafeSettings, Order, OrderItem, Payment } from '@/types/domain'

export interface ReceiptLine {
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  modifierLines: string[]
  note: string | null
}

export interface ReceiptData {
  cafeName: string
  address: string
  phone: string
  logoDataUrl: string | null
  paperSize: '58mm' | '80mm'
  orderNumber: string
  cashierName: string
  createdAtLabel: string
  orderTypeLabel: string
  tableLabel: string | null
  queueLabel: string | null
  lines: ReceiptLine[]
  subtotal: number
  discountAmount: number
  taxPercent: number
  taxAmount: number
  serviceChargePercent: number
  serviceChargeAmount: number
  roundingAdjustment: number
  grandTotal: number
  payments: { methodLabel: string; amount: number; receivedAmount: number | null; changeAmount: number | null }[]
  footerNote: string
  isVoided: boolean
}

const ORDER_TYPE_LABELS: Record<Order['type'], string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
}

export function buildSampleReceiptData(settings: CafeSettings): ReceiptData {
  return {
    cafeName: settings.cafeName,
    address: settings.address,
    phone: settings.phone,
    logoDataUrl: settings.logoDataUrl,
    paperSize: settings.receiptPaperSize,
    orderNumber: `${settings.transactionPrefix}-00000`,
    cashierName: 'Test Print',
    createdAtLabel: formatDateTime(Date.now()),
    orderTypeLabel: 'Dine-in',
    tableLabel: 'Meja 1',
    queueLabel: null,
    lines: [
      { name: 'Kopi Susu Gula Aren', qty: 2, unitPrice: 22000, lineTotal: 44000, modifierLines: ['  Ukuran: Regular'], note: null },
      { name: 'Nasi Goreng Kikost', qty: 1, unitPrice: 28000, lineTotal: 28000, modifierLines: [], note: 'Tidak pedas' },
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

export async function buildReceiptData(order: Order, settings: CafeSettings): Promise<ReceiptData> {
  const items = await db.orderItems.where('orderId').equals(order.id).toArray()
  const payments = await db.payments.where('orderId').equals(order.id).toArray()
  const table = order.tableId ? await db.cafeTables.get(order.tableId) : undefined

  const lines: ReceiptLine[] = items
    .filter((item) => !item.voided)
    .map((item: OrderItem) => ({
      name: item.productName,
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      modifierLines: item.modifiers.map((m) => `  ${m.groupName}: ${m.optionName}${m.priceDelta > 0 ? ` (+${m.priceDelta})` : ''}`),
      note: item.notes || null,
    }))

  return {
    cafeName: settings.cafeName,
    address: settings.address,
    phone: settings.phone,
    logoDataUrl: settings.logoDataUrl,
    paperSize: settings.receiptPaperSize,
    orderNumber: order.orderNumber,
    cashierName: order.cashierName,
    createdAtLabel: formatDateTime(order.paidAt ?? order.createdAt),
    orderTypeLabel: ORDER_TYPE_LABELS[order.type],
    tableLabel: table ? table.name : null,
    queueLabel: order.queueNumber ? `Antrean #${order.queueNumber}` : null,
    lines,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    taxPercent: order.taxPercent,
    taxAmount: order.taxAmount,
    serviceChargePercent: order.serviceChargePercent,
    serviceChargeAmount: order.serviceChargeAmount,
    roundingAdjustment: order.roundingAdjustment,
    grandTotal: order.grandTotal,
    payments: payments.map((p) => ({
      methodLabel: PAYMENT_METHOD_LABELS[p.method],
      amount: p.amount,
      receivedAmount: p.receivedAmount,
      changeAmount: p.changeAmount,
    })),
    footerNote: settings.receiptFooterNote,
    isVoided: order.status === 'void',
  }
}
