import { discountLinesOf } from '@/lib/promos'
import { db } from '@/db/schema'
import { formatDateTime } from '@/lib/datetime'
import { businessDisplayName } from '@/db/repositories/settings'
import { findGiftCard, getCustomerDeposit } from '@/db/repositories/deposits'
import { featuresForBusinessType } from '@/lib/businessType'
import { onlineChannelLabel } from '@/lib/onlineOrders'
import { qrOrderBaseUrlIsUsable } from '@/lib/qrOrderUrl'
import { billAdditions } from '@/lib/billAdditions'
import { getApiBaseUrl } from '@/sync/deviceConfig'
import type { AppSettings, KitchenTicketPayload, Order, OrderItem, Payment } from '@/types/domain'

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
  /** Rincian potongan (promo, voucher, tukar poin, diskon). Kosong = satu baris "Diskon". */
  discountLines?: { label: string; amount: number }[]
  /** Poin member yang didapat dari transaksi ini (hanya struk lunas). */
  pointsEarned?: number
  /** Sisa saldo member setelah transaksi ini — hanya bila dibayar dengan saldo. */
  depositBalance?: number
  /** Sisa nilai voucher hadiah yang dipakai di transaksi ini. */
  giftCardBalances?: { code: string; balance: number }[]
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
  /** Tagihan TAMBAHAN: `lines` hanya item sejak tagihan terakhir; total tetap total keseluruhan. */
  additions?: { subtotal: number } | null
  /** Pelayan yang melayani (bila dicatat). */
  waiterName?: string | null
  guestCount?: number | null
  /** Total tip dari semua pembayaran (0/undefined = tak ditampilkan). */
  tipTotal?: number
  /** Kanal pesanan online, mis. "GoFood #F-123". */
  onlineChannel?: string | null
  /** Halaman ulasan tamu untuk struk ini (QR di kaki struk). Kosong = tak dicetak. */
  reviewUrl?: string | null
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
  deposit: 'Saldo Member',
  giftcard: 'Voucher Hadiah',
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

/** Tiket dapur contoh untuk tombol "Test Dapur" — template sama dengan tiket sungguhan, tanpa harga. */
export function buildSampleKitchenTicket(settings: AppSettings, printerName: string): KitchenTicketPayload {
  return {
    outletName: businessDisplayName(settings),
    orderNumber: `${settings.transactionPrefix}-00000`,
    tableOrQueue: 'Antrean #12',
    customerName: 'Budi',
    orderedAtLabel: formatDateTime(Date.now()),
    cashierName: 'Uji Cetak',
    source: 'Kasir',
    ticketLabel: `TEST ${printerName}`,
    paperSize: settings.receiptPaperSize,
    lines: [
      { qty: 2, name: 'Kopi Susu Gula Aren', modifiers: ['Ukuran: Regular', 'Gula: Sedikit'], note: '' },
      { qty: 1, name: 'Nasi Goreng Spesial', modifiers: [], note: 'Tidak pedas' },
    ],
  }
}

export async function buildReceiptData(
  order: Order,
  settings: AppSettings,
  opts: { isReprint?: boolean; preBill?: boolean; additionsOnly?: boolean } = {},
): Promise<ReceiptData> {
  const items = await db.orderItems.where('orderId').equals(order.id).toArray()
  const payments = await db.payments.where('orderId').equals(order.id).toArray()
  const table = order.tableId ? await db.cafeTables.get(order.tableId) : undefined
  const features = featuresForBusinessType(settings.businessType)

  const toLine = (item: OrderItem, qty = item.qty, lineTotal = item.lineTotal): ReceiptLine => ({
    name: item.productName,
    qty,
    unitPrice: item.unitPrice,
    lineTotal,
    modifierLines: item.modifiers.map((m) => `  ${m.groupName}: ${m.optionName}${m.priceDelta > 0 ? ` (+${m.priceDelta})` : ''}`),
    note: item.notes || null,
  })
  const additions = opts.preBill && opts.additionsOnly ? billAdditions(order, items) : null
  const lines: ReceiptLine[] = additions
    ? additions.map((a) => toLine(a.item, a.qty, a.lineTotal))
    : items.filter((item) => !item.voided && !item.removed).map((item) => toLine(item))

  const giftCardBalances: { code: string; balance: number }[] = []
  if (!opts.preBill) {
    for (const code of new Set(payments.filter((p) => p.method === 'giftcard' && p.amount > 0 && p.reference).map((p) => p.reference as string))) {
      const card = await findGiftCard(code)
      if (card) giftCardBalances.push({ code: card.code, balance: card.balance })
    }
  }
  const depositOwner = opts.preBill ? null : (payments.find((p) => p.method === 'deposit' && p.amount > 0)?.customerId ?? null)
  const depositBalance = depositOwner ? (await getCustomerDeposit(depositOwner)).balance : undefined

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
    discountLines: discountLinesOf(order),
    pointsEarned: opts.preBill ? 0 : (order.pointsEarned ?? 0),
    ...(depositBalance != null ? { depositBalance } : {}),
    ...(giftCardBalances.length ? { giftCardBalances } : {}),
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
    additions: additions ? { subtotal: additions.reduce((s, a) => s + a.lineTotal, 0) } : null,
    waiterName: order.waiterName?.trim() || null,
    onlineChannel: onlineChannelLabel(order) || null,
    guestCount: order.type === 'dine_in' ? order.guestCount : null,
    tipTotal: payments.filter((p) => p.amount > 0).reduce((s, p) => s + (p.tipAmount ?? 0), 0),
    reviewUrl: !opts.preBill && order.status === 'paid' && settings.receiptReviewQr ? reviewUrlFor(order.id, settings) : null,
  }
}

/**
 * Alamat halaman ulasan untuk QR di struk. Memakai alamat server sinkronisasi
 * (di APK origin aplikasi `https://localhost` tak bisa dibuka tamu), lalu basis
 * URL QR meja, lalu origin perangkat. `null` bila tak ada alamat publik.
 */
export function reviewUrlFor(orderId: string, settings: Pick<AppSettings, 'qrOrderBaseUrl'>): string | null {
  const candidates = [getApiBaseUrl(), settings.qrOrderBaseUrl, typeof window !== 'undefined' ? window.location.origin : '']
  const base = candidates.map((c) => (c ?? '').trim().replace(/\/+$/, '')).find((c) => c !== '' && qrOrderBaseUrlIsUsable(c))
  return base ? `${base}/ulasan/${orderId}` : null
}
