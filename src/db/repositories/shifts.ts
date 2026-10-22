import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { getDeviceId } from '@/sync/device'
import { getSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { CashMovement, CashMovementType, Order, Shift } from '@/types/domain'
import { getTrustedNow } from '@/lib/clockGuard'

/**
 * Shift yang sedang berjalan DI PERANGKAT INI, atau `null` bila tidak ada.
 * Difilter per `deviceId` supaya setelah pull dari perangkat lain, shift terbuka
 * milik perangkat lain tidak dianggap sebagai shift perangkat ini.
 * Mengembalikan `null` (bukan `undefined`) supaya `useLiveQuery` bisa membedakan
 * "masih memuat" (`undefined`) dari "tidak ada shift" (`null`).
 */
export async function getOpenShift(): Promise<Shift | null> {
  const deviceId = getDeviceId()
  const own = await db.shifts
    .where('status')
    .equals('open')
    .filter((s) => (s.deviceId ?? 'legacy') === deviceId || s.deviceId == null)
    .first()
  return own ?? null
}

export async function openShift(params: {
  cashierId: string
  cashierName: string
  openingCash: number
}): Promise<Shift> {
  const existing = await getOpenShift()
  if (existing) throw new Error('Masih ada shift yang sedang berjalan di perangkat ini. Tutup shift tersebut terlebih dahulu.')
  const settings = await getSettings()
  const shift: Shift = {
    id: newId(),
    deviceId: getDeviceId(),
    outletId: settings.activeOutletId,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    openingCash: params.openingCash,
    expectedCash: params.openingCash,
    closingCashActual: null,
    variance: null,
    varianceApprovedBy: null,
    status: 'open',
    openedAt: getTrustedNow(),
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
      createdAt: getTrustedNow(),
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

export class CashVarianceApprovalRequiredError extends Error {
  constructor(public readonly variance: number) {
    super(`Selisih kas Rp${Math.abs(variance)} melewati toleransi — butuh persetujuan supervisor.`)
    this.name = 'CashVarianceApprovalRequiredError'
  }
}

export class OpenOrdersCarryOverRequiredError extends Error {
  constructor(public readonly count: number) {
    super(`Masih ada ${count} pesanan terbuka yang belum selesai. Konfirmasi untuk membawanya ke shift berikutnya.`)
    this.name = 'OpenOrdersCarryOverRequiredError'
  }
}

/** Pesanan terbuka (selain tagihan tertunda) yang akan terbawa bila shift ini ditutup. */
export async function listCarryOverOrders(shiftId: string): Promise<Order[]> {
  return db.orders
    .where('shiftId')
    .equals(shiftId)
    .filter((o) => o.status === 'open' && !o.payLater)
    .sortBy('createdAt')
}

/**
 * Pesanan terbuka yang terbawa dari shift yang sudah ditutup — diingatkan saat
 * shift baru dibuka. Pelunasannya pindah ke shift yang sedang buka (lihat `payBill`).
 */
export async function listOrdersFromClosedShifts(): Promise<Order[]> {
  const open = (await db.orders.where('status').equals('open').toArray()).filter((o) => !o.payLater && o.shiftId)
  if (open.length === 0) return []
  const shifts = await db.shifts.bulkGet([...new Set(open.map((o) => o.shiftId as string))])
  const closedIds = new Set(shifts.filter((s) => s?.status === 'closed').map((s) => s!.id))
  return open.filter((o) => closedIds.has(o.shiftId as string)).sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Menutup shift. Pesanan terbuka di shift ini boleh terbawa ke shift berikutnya,
 * tapi harus dikonfirmasi (`carryOverOpenOrders`) — kecuali yang sudah dibayar
 * sebagian: kasnya sudah masuk laci shift ini, jadi wajib dilunasi dulu. Selisih
 * kas absolut di atas `settings.cashVarianceTolerance` butuh penyetuju supervisor.
 */
export async function closeShift(params: {
  shiftId: string
  closingCashActual: number
  notes: string
  varianceApprover?: { userId: string; userName: string }
  /** Kasir sudah melihat peringatan & setuju pesanan terbuka dibawa ke shift berikutnya. */
  carryOverOpenOrders?: boolean
  /** Pencatat di log audit saat ada pesanan terbuka yang terbawa. */
  actor?: { userId: string; userName: string }
}): Promise<Shift> {
  const tolerance = (await getSettings()).cashVarianceTolerance
  return db.transaction('rw', [db.shifts, db.orders, db.bills, db.syncQueue, db.auditLogs], async () => {
    const shift = await db.shifts.get(params.shiftId)
    if (!shift) throw new Error('Shift tidak ditemukan')
    if (shift.status === 'closed') throw new Error('Shift sudah ditutup sebelumnya')

    // Tagihan tertunda (kantin) tak dihitung — memang boleh belum lunas lintas shift.
    const carryOver = await listCarryOverOrders(params.shiftId)
    if (carryOver.length > 0) {
      const bills = await db.bills.where('orderId').anyOf(carryOver.map((o) => o.id)).toArray()
      const partial = carryOver.filter((o) => bills.some((b) => b.orderId === o.id && b.paymentStatus === 'PARTIALLY_PAID'))
      if (partial.length > 0) {
        throw new Error(
          `Pesanan ${partial.map((o) => o.orderNumber).join(', ')} sudah dibayar sebagian. Lunasi dulu sebelum menutup shift.`,
        )
      }
      if (!params.carryOverOpenOrders) throw new OpenOrdersCarryOverRequiredError(carryOver.length)
    }

    const variance = params.closingCashActual - shift.expectedCash
    if (Math.abs(variance) > tolerance && !params.varianceApprover) {
      throw new CashVarianceApprovalRequiredError(variance)
    }

    const updatedShift: Shift = {
      ...shift,
      closingCashActual: params.closingCashActual,
      variance,
      varianceApprovedBy: params.varianceApprover?.userId ?? null,
      status: 'closed',
      closedAt: getTrustedNow(),
      notes: params.notes,
    }
    await db.shifts.put(updatedShift)
    await enqueueSync('shifts', shift.id, updatedShift)

    if (carryOver.length > 0) {
      await recordAuditLog({
        userId: params.actor?.userId ?? shift.cashierId,
        userName: params.actor?.userName ?? shift.cashierName,
        action: 'shift.close.carryOver',
        entityType: 'shift',
        entityId: shift.id,
        details: `${carryOver.length} pesanan terbuka dibawa ke shift berikutnya: ${carryOver.map((o) => o.orderNumber).join(', ')}.`,
      })
    }

    if (params.varianceApprover) {
      await recordAuditLog({
        userId: params.varianceApprover.userId,
        userName: params.varianceApprover.userName,
        action: 'shift.variance.approve',
        entityType: 'shift',
        entityId: shift.id,
        details: `Selisih kas Rp${variance} pada shift ${shift.cashierName} disetujui.`,
      })
    }
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
  /** Tip yang diterima shift ini — bukan omzet. Tip tunai sudah termasuk "kas seharusnya". */
  tipsCash: number
  tipsNonCash: number
  /** Bagian dari `nonCashSales` yang dibayar via aplikasi pesanan online (belum cair ke rekening). */
  platformSales: number
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
  const tipsCash = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + (p.tipAmount ?? 0), 0)
  const tipsNonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + (p.tipAmount ?? 0), 0)

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
    tipsCash,
    tipsNonCash,
    platformSales: payments.filter((p) => p.method === 'platform').reduce((s, p) => s + p.amount, 0),
  }
}
