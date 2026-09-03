import type { OrderLifecycleStatus, OrderStatus } from '@/types/domain'

/**
 * State machine siklus hidup order gaya POS matang.
 *
 *   DRAFT → CONFIRMED → PREPARING → READY → SERVED → COMPLETED
 *   DRAFT → CANCELLED            (batal sebelum item dikonfirmasi ke dapur)
 *   CONFIRMED/PREPARING/READY/SERVED → VOIDED   (dibatalkan, butuh supervisor)
 *
 * Transisi maju boleh "meloncat" (mis. CONFIRMED → COMPLETED untuk takeaway
 * bayar di muka), tetapi tidak boleh mundur dan tidak boleh keluar dari status
 * final. `assertTransition` dipakai satu pintu oleh `transitionOrder()` di repo.
 */
const ALLOWED: Record<OrderLifecycleStatus, OrderLifecycleStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'READY', 'SERVED', 'COMPLETED', 'VOIDED'],
  PREPARING: ['READY', 'SERVED', 'COMPLETED', 'VOIDED'],
  READY: ['SERVED', 'COMPLETED', 'VOIDED'],
  SERVED: ['COMPLETED', 'VOIDED'],
  // COMPLETED → VOIDED: pembatalan penuh transaksi yang sudah dibayar oleh
  // supervisor (menghasilkan pembayaran pembalik). Retur per-item TIDAK memakai
  // transisi ini — order tetap COMPLETED + ReturnRecord.
  COMPLETED: ['VOIDED'],
  CANCELLED: [],
  VOIDED: [],
}

export const FINAL_LIFECYCLE: ReadonlySet<OrderLifecycleStatus> = new Set([
  'COMPLETED',
  'CANCELLED',
  'VOIDED',
])

export function canTransition(from: OrderLifecycleStatus, to: OrderLifecycleStatus): boolean {
  if (from === to) return true
  return ALLOWED[from].includes(to)
}

export class InvalidOrderTransitionError extends Error {
  constructor(from: OrderLifecycleStatus, to: OrderLifecycleStatus) {
    super(`Transisi status order tidak sah: ${from} → ${to}`)
    this.name = 'InvalidOrderTransitionError'
  }
}

export function assertTransition(from: OrderLifecycleStatus, to: OrderLifecycleStatus): void {
  if (!canTransition(from, to)) throw new InvalidOrderTransitionError(from, to)
}

/** Status legacy (`open/paid/void/completed`) yang sepadan dengan sebuah lifecycle status. */
export function legacyStatusFor(lifecycle: OrderLifecycleStatus): OrderStatus {
  if (lifecycle === 'COMPLETED') return 'paid'
  if (lifecycle === 'VOIDED' || lifecycle === 'CANCELLED') return 'void'
  return 'open'
}

/**
 * Menurunkan lifecycle status dari agregat status dapur seluruh item aktif.
 * Dipakai setelah setiap perubahan `kitchenStatus` untuk menggerakkan
 * CONFIRMED → PREPARING → READY → SERVED secara otomatis (tanpa aksi kasir).
 */
export function deriveKitchenPhase(
  current: OrderLifecycleStatus,
  itemKitchenStatuses: Array<'new' | 'in_progress' | 'ready' | 'done'>,
): OrderLifecycleStatus {
  if (FINAL_LIFECYCLE.has(current) || current === 'DRAFT') return current
  if (itemKitchenStatuses.length === 0) return 'CONFIRMED'
  if (itemKitchenStatuses.every((s) => s === 'done')) return 'SERVED'
  if (itemKitchenStatuses.every((s) => s === 'ready' || s === 'done')) return 'READY'
  if (itemKitchenStatuses.some((s) => s === 'in_progress' || s === 'ready' || s === 'done')) return 'PREPARING'
  return 'CONFIRMED'
}
