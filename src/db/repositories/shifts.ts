import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { CashMovement, CashMovementType, Shift } from '@/types/domain'

export async function getOpenShift(): Promise<Shift | undefined> {
  return db.shifts.where('status').equals('open').first()
}

export async function openShift(params: {
  cashierId: string
  cashierName: string
  openingCash: number
}): Promise<Shift> {
  const existing = await getOpenShift()
  if (existing) throw new Error('Masih ada shift yang sedang berjalan. Tutup shift tersebut terlebih dahulu.')
  const shift: Shift = {
    id: newId(),
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    openingCash: params.openingCash,
    expectedCash: params.openingCash,
    closingCashActual: null,
    variance: null,
    status: 'open',
    openedAt: Date.now(),
    closedAt: null,
    notes: '',
  }
  await db.transaction('rw', db.shifts, db.syncQueue, async () => {
    await db.shifts.add(shift)
    await enqueueSync('shifts', shift.id, shift)
  })
  return shift
}

export async function addExpectedCash(shiftId: string, delta: number): Promise<void> {
  await db.transaction('rw', db.shifts, db.syncQueue, async () => {
    const shift = await db.shifts.get(shiftId)
    if (!shift) return
    await db.shifts.update(shiftId, { expectedCash: shift.expectedCash + delta })
    const updated = await db.shifts.get(shiftId)
    if (updated) await enqueueSync('shifts', shiftId, updated)
  })
}

export async function addCashMovement(params: {
  shiftId: string
  type: CashMovementType
  amount: number
  reason: string
  userId: string
}): Promise<CashMovement> {
  return db.transaction('rw', db.shifts, db.cashMovements, db.syncQueue, async () => {
    const movement: CashMovement = {
      id: newId(),
      shiftId: params.shiftId,
      type: params.type,
      amount: params.amount,
      reason: params.reason,
      userId: params.userId,
      createdAt: Date.now(),
    }
    await db.cashMovements.add(movement)
    await enqueueSync('cashMovements', movement.id, movement)
    const delta = params.type === 'in' ? params.amount : -params.amount
    await addExpectedCash(params.shiftId, delta)
    return movement
  })
}

export async function listCashMovements(shiftId: string): Promise<CashMovement[]> {
  return db.cashMovements.where('shiftId').equals(shiftId).sortBy('createdAt')
}

/** Menutup shift. Ditolak apabila masih ada open bill yang berkaitan dengan shift ini. */
export async function closeShift(params: {
  shiftId: string
  closingCashActual: number
  notes: string
}): Promise<Shift> {
  return db.transaction('rw', db.shifts, db.orders, db.syncQueue, async () => {
    const shift = await db.shifts.get(params.shiftId)
    if (!shift) throw new Error('Shift tidak ditemukan')
    if (shift.status === 'closed') throw new Error('Shift sudah ditutup sebelumnya')

    const openOrdersInShift = await db.orders
      .where('shiftId')
      .equals(params.shiftId)
      .filter((o) => o.status === 'open')
      .count()
    if (openOrdersInShift > 0) {
      throw new Error('Masih ada open bill yang belum diselesaikan. Selesaikan seluruh pesanan terbuka terlebih dahulu.')
    }

    const variance = params.closingCashActual - shift.expectedCash
    const updatedShift: Shift = {
      ...shift,
      closingCashActual: params.closingCashActual,
      variance,
      status: 'closed',
      closedAt: Date.now(),
      notes: params.notes,
    }
    await db.shifts.put(updatedShift)
    await enqueueSync('shifts', shift.id, updatedShift)
    return updatedShift
  })
}

export interface ShiftSummary {
  shift: Shift
  cashSales: number
  nonCashSales: number
  totalSales: number
  transactionCount: number
  cashIn: number
  cashOut: number
  totalExpenses: number
  discountTotal: number
  taxTotal: number
  serviceChargeTotal: number
  returnTotal: number
  voidCount: number
}

export async function buildShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const shift = await db.shifts.get(shiftId)
  if (!shift) throw new Error('Shift tidak ditemukan')

  const orders = await db.orders.where('shiftId').equals(shiftId).toArray()
  const paidOrders = orders.filter((o) => o.status === 'paid' || o.status === 'completed')
  const voidOrders = orders.filter((o) => o.status === 'void')

  const orderIds = paidOrders.map((o) => o.id)
  const payments = orderIds.length ? await db.payments.where('orderId').anyOf(orderIds).toArray() : []
  const cashSales = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  const nonCashSales = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0)

  const movements = await listCashMovements(shiftId)
  const cashIn = movements.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0)
  const cashOut = movements.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0)

  const expenses = await db.expenses.where('shiftId').equals(shiftId).toArray()
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)

  const returns = orderIds.length
    ? await db.returns.where('orderId').anyOf(orderIds).toArray()
    : []
  const returnTotal = returns.reduce((s, r) => s + r.refundAmount, 0)

  return {
    shift,
    cashSales,
    nonCashSales,
    totalSales: cashSales + nonCashSales,
    transactionCount: paidOrders.length,
    cashIn,
    cashOut,
    totalExpenses,
    discountTotal: paidOrders.reduce((s, o) => s + o.discountAmount, 0),
    taxTotal: paidOrders.reduce((s, o) => s + o.taxAmount, 0),
    serviceChargeTotal: paidOrders.reduce((s, o) => s + o.serviceChargeAmount, 0),
    returnTotal,
    voidCount: voidOrders.length,
  }
}
