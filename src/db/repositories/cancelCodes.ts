import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { hashPin, verifyPin } from '@/lib/pinHash'
import { getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'
import { getTrustedNow } from '@/lib/clockGuard'
import type { CancelCode, User } from '@/types/domain'

/**
 * Kode pembatalan sekali pakai (kantin, flag `ownerPinCancel`).
 *
 * Pemilik membuat kode 6 digit acak di Pengaturan → Kode Pembatalan; kode hanya
 * tampil SEKALI saat dibuat dan hangus begitu dipakai untuk satu pembatalan,
 * jadi kasir yang pernah melihatnya tak bisa memakainya lagi. Hanya hash-nya
 * yang disimpan, lokal di tablet ini (tidak ikut sinkronisasi maupun backup).
 * Membuat kode baru menggantikan kode lama yang belum terpakai.
 */

export const CANCEL_CODE_LENGTH = 6
/** Cakupan rate limit percobaan kode (pakai limiter login: 5× salah → kunci 30 detik). */
const RATE_LIMIT_SCOPE = 'cancel-code'

export class OwnerApprovalRequiredError extends Error {
  constructor(message = 'Pembatalan pesanan butuh kode pembatalan dari Pemilik.') {
    super(message)
    this.name = 'OwnerApprovalRequiredError'
  }
}

/** Persetujuan pembatalan dari Pemilik — hasil `verifyCancelCode`, dikonsumsi di transaksi pembatalan. */
export interface OwnerApproval {
  approverUserId: string
  approverName: string
  /** `createdAt` kode yang diverifikasi — memastikan kode yang dihapus adalah kode yang sama. */
  codeCreatedAt: number
}

function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10 ** CANCEL_CODE_LENGTH
  return n.toString().padStart(CANCEL_CODE_LENGTH, '0')
}

export async function isOwnerCancelRequired(): Promise<boolean> {
  return featuresForBusinessType((await getSettings()).businessType).ownerPinCancel
}

export async function hasActiveOwner(): Promise<boolean> {
  return (await db.users.filter((u) => u.active && u.role === 'pemilik').count()) > 0
}

export async function getActiveCancelCode(): Promise<Pick<CancelCode, 'createdAt' | 'createdByName'> | null> {
  const row = await db.cancelCodes.get('active')
  return row ? { createdAt: row.createdAt, createdByName: row.createdByName } : null
}

/** Membuat kode baru (menggantikan yang lama). Mengembalikan kode polos — tampilkan sekali saja. */
export async function generateCancelCode(owner: User): Promise<string> {
  if (owner.role !== 'pemilik' || !owner.active) throw new Error('Hanya akun Pemilik yang dapat membuat kode pembatalan.')
  const code = randomCode()
  const { hash, salt } = await hashPin(code)
  const now = getTrustedNow()
  await db.transaction('rw', db.cancelCodes, db.auditLogs, db.syncQueue, async () => {
    await db.cancelCodes.put({ id: 'active', hash, salt, createdAt: now, createdByUserId: owner.id, createdByName: owner.name })
    await recordAuditLog({
      userId: owner.id,
      userName: owner.name,
      action: 'cancel_code.generate',
      entityType: 'cancel_code',
      entityId: 'active',
      details: 'Kode pembatalan baru dibuat (kode lama yang belum terpakai hangus).',
    })
  })
  return code
}

export async function revokeCancelCode(owner: User): Promise<void> {
  await db.transaction('rw', db.cancelCodes, db.auditLogs, db.syncQueue, async () => {
    await db.cancelCodes.delete('active')
    await recordAuditLog({
      userId: owner.id,
      userName: owner.name,
      action: 'cancel_code.revoke',
      entityType: 'cancel_code',
      entityId: 'active',
      details: 'Kode pembatalan dihapus oleh Pemilik.',
    })
  })
}

export type VerifyCancelCodeResult =
  | { ok: true; approval: OwnerApproval }
  | { ok: false; reason: 'locked'; retryInMs: number }
  | { ok: false; reason: 'no_code' | 'invalid' | 'owner_inactive' }

/**
 * Mencocokkan kode TANPA menghapusnya — hashing (WebCrypto) tak boleh berjalan
 * di dalam transaksi Dexie. Kode dihapus oleh `consumeCancelCodeInTx` di dalam
 * transaksi pembatalan, supaya pembatalan yang gagal tak membuang kodenya.
 */
export async function verifyCancelCode(code: string): Promise<VerifyCancelCodeResult> {
  const retryInMs = getLockoutRemainingMs(RATE_LIMIT_SCOPE)
  if (retryInMs > 0) return { ok: false, reason: 'locked', retryInMs }
  const row = await db.cancelCodes.get('active')
  if (!row) return { ok: false, reason: 'no_code' }
  if (!(await verifyPin(code, row.salt, row.hash))) {
    recordFailedAttempt(RATE_LIMIT_SCOPE)
    return { ok: false, reason: 'invalid' }
  }
  recordSuccessfulAttempt(RATE_LIMIT_SCOPE)
  const owner = await db.users.get(row.createdByUserId)
  if (!owner || !owner.active || owner.role !== 'pemilik') return { ok: false, reason: 'owner_inactive' }
  return { ok: true, approval: { approverUserId: owner.id, approverName: owner.name, codeCreatedAt: row.createdAt } }
}

/** Menghapus kode yang sudah diverifikasi. Wajib dipanggil di dalam transaksi yang menyertakan `db.cancelCodes`. */
export async function consumeCancelCodeInTx(approval: OwnerApproval): Promise<void> {
  const row = await db.cancelCodes.get('active')
  if (!row || row.createdAt !== approval.codeCreatedAt || row.createdByUserId !== approval.approverUserId) {
    throw new OwnerApprovalRequiredError('Kode pembatalan sudah terpakai atau diganti. Minta kode baru ke Pemilik.')
  }
  await db.cancelCodes.delete('active')
}
