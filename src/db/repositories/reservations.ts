import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { startOrder } from '@/db/repositories/orders'
import { getTrustedNow } from '@/lib/clockGuard'
import type { Order, Reservation, ReservationStatus } from '@/types/domain'

/** Lama satu reservasi dianggap "memakai" meja — dasar cek bentrok & penanda di denah. */
export const RESERVATION_SLOT_MS = 2 * 60 * 60 * 1000
/** Denah menandai meja "Dipesan" mulai sekian sebelum jam reservasi. */
export const RESERVATION_HOLD_BEFORE_MS = 2 * 60 * 60 * 1000
/** Setelah lewat sekian dari jam reservasi tanpa kedatangan, meja tak lagi ditahan di denah. */
export const RESERVATION_LATE_GRACE_MS = 30 * 60 * 1000

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  booked: 'Dipesan',
  seated: 'Sudah Datang',
  cancelled: 'Dibatalkan',
  no_show: 'Tidak Datang',
}

export interface ReservationInput {
  customerName: string
  phone: string
  guestCount: number
  reservedAt: number
  tableId: string | null
  note: string
}

type Actor = { userId: string; userName: string }

export class ReservationConflictError extends Error {
  constructor(tableName: string, other: Reservation) {
    super(`${tableName} sudah dipesan ${other.customerName} pada jam yang berdekatan. Pilih meja atau jam lain.`)
    this.name = 'ReservationConflictError'
  }
}

function validate(input: ReservationInput): void {
  if (!input.customerName.trim()) throw new Error('Nama pemesan wajib diisi.')
  if (!Number.isFinite(input.reservedAt) || input.reservedAt <= 0) throw new Error('Tanggal & jam reservasi wajib diisi.')
  if (!Number.isFinite(input.guestCount) || input.guestCount < 1) throw new Error('Jumlah tamu minimal 1.')
}

/** Reservasi aktif lain di meja yang sama dalam jendela ±RESERVATION_SLOT_MS. */
async function findConflict(tableId: string, reservedAt: number, ignoreId?: string): Promise<Reservation | undefined> {
  return db.reservations
    .where('tableId')
    .equals(tableId)
    .filter((r) => r.status === 'booked' && r.id !== ignoreId && Math.abs(r.reservedAt - reservedAt) < RESERVATION_SLOT_MS)
    .first()
}

export async function listReservations(range?: { from: number; to: number }): Promise<Reservation[]> {
  const rows = range
    ? await db.reservations.where('reservedAt').between(range.from, range.to, true, true).toArray()
    : await db.reservations.toArray()
  return rows.sort((a, b) => a.reservedAt - b.reservedAt)
}

export async function createReservation(input: ReservationInput, actor: Actor): Promise<Reservation> {
  validate(input)
  return db.transaction('rw', db.reservations, db.cafeTables, db.syncQueue, db.auditLogs, async () => {
    if (input.tableId) {
      const conflict = await findConflict(input.tableId, input.reservedAt)
      if (conflict) throw new ReservationConflictError((await db.cafeTables.get(input.tableId))?.name ?? 'Meja', conflict)
    }
    const now = getTrustedNow()
    const reservation: Reservation = {
      id: newId(),
      customerName: input.customerName.trim(),
      phone: input.phone.trim(),
      guestCount: Math.round(input.guestCount),
      reservedAt: input.reservedAt,
      tableId: input.tableId,
      note: input.note.trim(),
      status: 'booked',
      orderId: null,
      createdByUserId: actor.userId,
      createdByName: actor.userName,
      createdAt: now,
      updatedAt: now,
    }
    await db.reservations.add(reservation)
    await enqueueSync('reservations', reservation.id, reservation)
    await recordAuditLog({
      ...actor,
      action: 'reservation.create',
      entityType: 'reservation',
      entityId: reservation.id,
      details: `Reservasi ${reservation.customerName} (${reservation.guestCount} tamu) dibuat.`,
    })
    return reservation
  })
}

export async function updateReservation(id: string, input: ReservationInput): Promise<void> {
  validate(input)
  await db.transaction('rw', db.reservations, db.cafeTables, db.syncQueue, async () => {
    const existing = await db.reservations.get(id)
    if (!existing) throw new Error('Reservasi tidak ditemukan')
    if (existing.status !== 'booked') throw new Error('Reservasi ini sudah tidak bisa diubah.')
    if (input.tableId) {
      const conflict = await findConflict(input.tableId, input.reservedAt, id)
      if (conflict) throw new ReservationConflictError((await db.cafeTables.get(input.tableId))?.name ?? 'Meja', conflict)
    }
    const updated: Reservation = {
      ...existing,
      customerName: input.customerName.trim(),
      phone: input.phone.trim(),
      guestCount: Math.round(input.guestCount),
      reservedAt: input.reservedAt,
      tableId: input.tableId,
      note: input.note.trim(),
      updatedAt: getTrustedNow(),
    }
    await db.reservations.put(updated)
    await enqueueSync('reservations', id, updated)
  })
}

/** Membatalkan reservasi atau menandainya "tidak datang". Hanya dari status `booked`. */
export async function closeReservation(id: string, status: 'cancelled' | 'no_show', actor: Actor): Promise<void> {
  await db.transaction('rw', db.reservations, db.syncQueue, db.auditLogs, async () => {
    const existing = await db.reservations.get(id)
    if (!existing) throw new Error('Reservasi tidak ditemukan')
    if (existing.status !== 'booked') return
    const updated: Reservation = { ...existing, status, updatedAt: getTrustedNow() }
    await db.reservations.put(updated)
    await enqueueSync('reservations', id, updated)
    await recordAuditLog({
      ...actor,
      action: status === 'cancelled' ? 'reservation.cancel' : 'reservation.no_show',
      entityType: 'reservation',
      entityId: id,
      details: `Reservasi ${existing.customerName} ditandai ${RESERVATION_STATUS_LABELS[status].toLowerCase()}.`,
    })
  })
}

/**
 * Tamu reservasi datang: buka pesanan dine-in di mejanya (nama pemesan jadi catatan
 * pesanan) lalu tandai reservasi `seated`. Meja harus sedang tersedia.
 */
export async function seatReservation(
  id: string,
  params: {
    tableId: string
    cashierId: string
    cashierName: string
    shiftId: string
    waiter?: { id: string; name: string } | null
  },
): Promise<Order> {
  const reservation = await db.reservations.get(id)
  if (!reservation) throw new Error('Reservasi tidak ditemukan')
  if (reservation.status !== 'booked') throw new Error('Reservasi ini sudah diproses.')
  const table = await db.cafeTables.get(params.tableId)
  if (!table) throw new Error('Meja tidak ditemukan')
  if (table.status !== 'available') throw new Error(`${table.name} belum tersedia — kosongkan dulu atau pilih meja lain.`)

  const order = await startOrder({
    type: 'dine_in',
    tableId: params.tableId,
    guestCount: reservation.guestCount,
    notes: reservation.customerName,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    waiter: params.waiter,
    shiftId: params.shiftId,
  })
  await db.transaction('rw', db.reservations, db.syncQueue, async () => {
    const updated: Reservation = {
      ...reservation,
      status: 'seated',
      tableId: params.tableId,
      orderId: order.id,
      updatedAt: getTrustedNow(),
    }
    await db.reservations.put(updated)
    await enqueueSync('reservations', id, updated)
  })
  return order
}

/**
 * Reservasi yang sedang "menahan" meja saat `now`: dari RESERVATION_HOLD_BEFORE_MS
 * sebelum jamnya sampai RESERVATION_LATE_GRACE_MS setelahnya. Satu per meja —
 * yang paling dekat jamnya.
 */
export async function heldReservationsByTable(now: number): Promise<Map<string, Reservation>> {
  const rows = await db.reservations
    .where('reservedAt')
    .between(now - RESERVATION_LATE_GRACE_MS, now + RESERVATION_HOLD_BEFORE_MS, true, true)
    .filter((r) => r.status === 'booked' && !!r.tableId)
    .toArray()
  const map = new Map<string, Reservation>()
  for (const r of rows.sort((a, b) => a.reservedAt - b.reservedAt)) {
    if (r.tableId && !map.has(r.tableId)) map.set(r.tableId, r)
  }
  return map
}
