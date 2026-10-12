import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { findGiftCard, recordCustomerDeposit, sellGiftCard } from '@/db/repositories/deposits'
import { addOrderItem, startOrder } from '@/db/repositories/orders'
import { closeReservation, createReservation } from '@/db/repositories/reservations'
import { getOpenShift } from '@/db/repositories/shifts'
import { getTrustedNow } from '@/lib/clockGuard'
import type { Order, PaymentMethod, PreOrderLine, Reservation } from '@/types/domain'

type Actor = { userId: string; userName: string }

/** Pesanan terjadwal muncul sebagai "perlu disiapkan" mulai sekian sebelum jamnya. */
export const PRE_ORDER_DUE_SOON_MS = 2 * 60 * 60 * 1000

export interface PreOrderInput {
  customerName: string
  phone: string
  reservedAt: number
  guestCount: number
  note: string
  fulfillment: 'dine_in' | 'takeaway'
  lines: PreOrderLine[]
  /** Uang muka (0 = tanpa uang muka) & cara tamu membayarnya. */
  depositAmount: number
  depositMethod: PaymentMethod
}

export function preOrderTotal(lines: PreOrderLine[]): number {
  return lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
}

function cleanLines(lines: PreOrderLine[]): PreOrderLine[] {
  return lines
    .filter((l) => l.qty > 0)
    .map((l) => ({ productId: l.productId, name: l.name, qty: Math.floor(l.qty), unitPrice: Math.round(l.unitPrice), note: l.note.trim() }))
}

/**
 * Mencatat pesanan untuk tanggal mendatang. Uang muka (bila ada) diterima sekarang dan
 * disimpan sebagai voucher hadiah — titipan, BUKAN omzet — sampai pesanannya dilunasi.
 */
export async function createPreOrder(input: PreOrderInput, actor: Actor): Promise<Reservation> {
  const lines = cleanLines(input.lines)
  if (lines.length === 0) throw new Error('Pilih minimal satu menu.')
  if (!(input.reservedAt > getTrustedNow() - 60 * 60 * 1000)) throw new Error('Tanggal & jam pesanan sudah lewat.')
  const depositAmount = Math.max(0, Math.round(input.depositAmount))
  if (depositAmount > preOrderTotal(lines)) throw new Error('Uang muka melebihi perkiraan total pesanan.')
  if (!input.customerName.trim()) throw new Error('Nama pemesan wajib diisi.')
  if (depositAmount > 0 && input.depositMethod === 'cash' && !(await getOpenShift())) throw new Error('Buka shift terlebih dahulu untuk menerima uang muka tunai.')
  // Reservasi dibuat dulu: bila gagal (mis. nama kosong), belum ada uang yang tercatat.
  const reservation = await createReservation(
    { customerName: input.customerName, phone: input.phone, guestCount: Math.max(1, input.guestCount), reservedAt: input.reservedAt, tableId: null, note: input.note },
    actor,
  )
  let withPreOrder: Reservation = { ...reservation, preOrder: { lines, fulfillment: input.fulfillment } }
  try {
    if (depositAmount > 0) {
      const card = await sellGiftCard({ amount: depositAmount, method: input.depositMethod, recipient: `Uang muka pesanan ${reservation.customerName}`, actor })
      withPreOrder = { ...withPreOrder, preOrder: { ...withPreOrder.preOrder!, depositCode: card.code, depositAmount } }
    }
  } catch (e) {
    // Uang muka gagal dicatat (mis. shift belum dibuka): jangan sisakan pesanan tanpa uang mukanya.
    await closeReservation(reservation.id, 'cancelled', actor)
    throw e
  }
  withPreOrder.updatedAt = getTrustedNow()
  await db.transaction('rw', db.reservations, db.syncQueue, async () => {
    await db.reservations.put(withPreOrder)
    await enqueueSync('reservations', withPreOrder.id, withPreOrder)
  })
  await recordAuditLog({
    ...actor,
    action: 'preorder.create',
    entityType: 'reservation',
    entityId: withPreOrder.id,
    details: `Pesanan terjadwal ${withPreOrder.customerName}: ${lines.length} menu, perkiraan Rp${preOrderTotal(lines).toLocaleString('id-ID')}${depositAmount > 0 ? `, uang muka Rp${depositAmount.toLocaleString('id-ID')} (${input.depositMethod})` : ''}.`,
  })
  return withPreOrder
}

export async function listPreOrders(): Promise<Reservation[]> {
  return (await db.reservations.toArray()).filter((r) => r.preOrder).sort((a, b) => a.reservedAt - b.reservedAt)
}

/** Pesanan terjadwal yang belum diproses dan sudah waktunya disiapkan (jatuh tempo ≤ 2 jam lagi, atau terlewat hari ini). */
export async function countDuePreOrders(now: number, dayStart: number): Promise<number> {
  return db.reservations
    .where('reservedAt')
    .between(dayStart, now + PRE_ORDER_DUE_SOON_MS, true, true)
    .filter((r) => !!r.preOrder && r.status === 'booked')
    .count()
}

/** Sisa uang muka sebuah pesanan terjadwal (0 bila tanpa uang muka atau sudah terpakai/dikembalikan). */
export async function preOrderDepositBalance(reservation: Reservation): Promise<number> {
  const code = reservation.preOrder?.depositCode
  return code ? ((await findGiftCard(code))?.balance ?? 0) : 0
}

/**
 * Waktunya tiba: buka pesanan berisi menu yang dipesan (harga mengikuti menu SAAT INI),
 * lalu tandai pesanan terjadwal selesai diproses. Menu yang sudah tak dijual dilewati
 * dan dilaporkan lewat `skipped`.
 */
export async function startPreOrder(
  id: string,
  params: { tableId?: string | null; cashierId: string; cashierName: string; shiftId: string; waiter?: { id: string; name: string } | null },
): Promise<{ order: Order; skipped: string[] }> {
  const reservation = await db.reservations.get(id)
  if (!reservation?.preOrder) throw new Error('Pesanan terjadwal tidak ditemukan')
  if (reservation.status !== 'booked') throw new Error('Pesanan terjadwal ini sudah diproses.')
  const { preOrder } = reservation
  const dineIn = preOrder.fulfillment === 'dine_in' && !!params.tableId
  if (dineIn) {
    const table = await db.cafeTables.get(params.tableId as string)
    if (!table) throw new Error('Meja tidak ditemukan')
    if (table.status !== 'available') throw new Error(`${table.name} belum tersedia — kosongkan dulu atau pilih meja lain.`)
  }
  const order = await startOrder({
    type: dineIn ? 'dine_in' : 'takeaway',
    tableId: dineIn ? (params.tableId as string) : undefined,
    guestCount: reservation.guestCount,
    notes: reservation.customerName,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    waiter: params.waiter,
    prepaidCode: preOrder.depositCode ?? null,
    shiftId: params.shiftId,
  })
  const skipped: string[] = []
  for (const line of preOrder.lines) {
    const product = await db.products.get(line.productId)
    if (!product || product.archived) {
      skipped.push(line.name)
      continue
    }
    await addOrderItem({ orderId: order.id, productId: product.id, productName: product.name, unitPrice: product.price, qty: line.qty, modifiers: [], notes: line.note })
  }
  await db.transaction('rw', db.reservations, db.syncQueue, async () => {
    const updated: Reservation = { ...reservation, status: 'seated', tableId: dineIn ? (params.tableId as string) : null, orderId: order.id, updatedAt: getTrustedNow() }
    await db.reservations.put(updated)
    await enqueueSync('reservations', id, updated)
  })
  return { order: (await db.orders.get(order.id)) ?? order, skipped }
}

/**
 * Membatalkan pesanan terjadwal. `refundMethod` diisi = sisa uang muka dikembalikan ke
 * tamu lewat cara itu; kosong = uang muka tetap tersimpan sebagai voucher hadiah tamu.
 */
export async function cancelPreOrder(id: string, params: { refundMethod: PaymentMethod | null }, actor: Actor): Promise<{ refunded: number }> {
  const reservation = await db.reservations.get(id)
  if (!reservation?.preOrder) throw new Error('Pesanan terjadwal tidak ditemukan')
  if (reservation.status !== 'booked') throw new Error('Pesanan terjadwal ini sudah diproses.')
  let refunded = 0
  const code = reservation.preOrder.depositCode
  if (code && params.refundMethod) {
    const card = await findGiftCard(code)
    if (card && card.balance > 0) {
      await recordCustomerDeposit({ customerId: card.id, amount: -card.balance, method: params.refundMethod, note: `Pembatalan pesanan terjadwal ${reservation.customerName}`, actor })
      refunded = card.balance
    }
  }
  await closeReservation(id, 'cancelled', actor)
  return { refunded }
}
