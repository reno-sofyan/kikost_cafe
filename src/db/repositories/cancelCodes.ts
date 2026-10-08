import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { hashPin, verifyPin } from '@/lib/pinHash'
import { getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'
import { getTrustedNow } from '@/lib/clockGuard'
import { consumeServerOwnerCode, isBackendConfigured } from '@/sync/client'
import type { CancelCode, User } from '@/types/domain'

/**
 * Kode pembatalan sekali pakai (kantin, flag `ownerPinCancel`).
 *
 * Pemilik membuat kode 6 digit acak di Pengaturan → Kode Pembatalan; kode hanya
 * tampil SEKALI saat dibuat dan hangus begitu dipakai untuk satu pembatalan,
 * jadi kasir yang pernah melihatnya tak bisa memakainya lagi. Hanya hash-nya
 * yang disimpan, lokal di tablet ini (tidak ikut sinkronisasi maupun backup).
 * Membuat kode baru menggantikan kode lama yang belum terpakai.
 *
 * Pemilik juga bisa membuat kode dari konsol /ops (server). Kode yang tak cocok
 * dengan kode lokal dicocokkan ke server — butuh internet saat itu — dan server
 * langsung menghanguskannya. Persetujuan dicatat atas nama akun Pemilik tablet ini.
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
  /** 'server' = kode dari konsol /ops, sudah dihanguskan server saat dicocokkan. */
  source?: 'local' | 'server'
}

/** Persetujuan dari kode server yang sudah dipakai di tablet ini — tiap persetujuan hanya untuk SATU pembatalan. */
const usedServerApprovals = new WeakSet<OwnerApproval>()

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
  | { ok: false; reason: 'no_code' | 'invalid' | 'owner_inactive' | 'offline' }

/**
 * Mencocokkan kode TANPA menghapusnya — hashing (WebCrypto) tak boleh berjalan
 * di dalam transaksi Dexie. Kode dihapus oleh `consumeCancelCodeInTx` di dalam
 * transaksi pembatalan, supaya pembatalan yang gagal tak membuang kodenya.
 */
export async function verifyCancelCode(code: string): Promise<VerifyCancelCodeResult> {
  const retryInMs = getLockoutRemainingMs(RATE_LIMIT_SCOPE)
  if (retryInMs > 0) return { ok: false, reason: 'locked', retryInMs }
  const row = await db.cancelCodes.get('active')
  if (row && (await verifyPin(code, row.salt, row.hash))) {
    recordSuccessfulAttempt(RATE_LIMIT_SCOPE)
    const owner = await db.users.get(row.createdByUserId)
    if (!owner || !owner.active || owner.role !== 'pemilik') return { ok: false, reason: 'owner_inactive' }
    return { ok: true, approval: { approverUserId: owner.id, approverName: owner.name, codeCreatedAt: row.createdAt, source: 'local' } }
  }
  if (!isBackendConfigured()) {
    if (!row) return { ok: false, reason: 'no_code' }
    recordFailedAttempt(RATE_LIMIT_SCOPE)
    return { ok: false, reason: 'invalid' }
  }
  return verifyServerCode(code, !!row)
}

/**
 * Kode dari konsol /ops. Akun Pemilik dicek SEBELUM bertanya ke server, karena
 * server menghanguskan kode yang cocok — jangan sampai kode terbuang lalu ditolak.
 */
async function verifyServerCode(code: string, hasLocalCode: boolean): Promise<VerifyCancelCodeResult> {
  const owner = await db.users.filter((u) => u.active && u.role === 'pemilik').first()
  if (!owner) return { ok: false, reason: 'owner_inactive' }
  let res
  try {
    res = await consumeServerOwnerCode(code)
  } catch {
    // Server tak terjangkau: kode lokal yang ada pasti salah; tanpa kode lokal, kode
    // ini mungkin kode /ops yang benar — jangan dihitung sebagai percobaan salah.
    if (hasLocalCode) recordFailedAttempt(RATE_LIMIT_SCOPE)
    return { ok: false, reason: 'offline' }
  }
  if (res.ok) {
    recordSuccessfulAttempt(RATE_LIMIT_SCOPE)
    return { ok: true, approval: { approverUserId: owner.id, approverName: owner.name, codeCreatedAt: res.createdAt, source: 'server' } }
  }
  if (res.reason === 'locked') return { ok: false, reason: 'locked', retryInMs: res.retryInMs }
  if (res.reason === 'no_code' && !hasLocalCode) return { ok: false, reason: 'no_code' }
  recordFailedAttempt(RATE_LIMIT_SCOPE)
  return { ok: false, reason: 'invalid' }
}

/** Menghapus kode yang sudah diverifikasi. Wajib dipanggil di dalam transaksi yang menyertakan `db.cancelCodes`. */
export async function consumeCancelCodeInTx(approval: OwnerApproval): Promise<void> {
  if (approval.source === 'server') {
    // Kodenya sudah dihanguskan server saat dicocokkan; cegah objek persetujuan yang
    // sama dipakai untuk pembatalan kedua.
    if (usedServerApprovals.has(approval)) {
      throw new OwnerApprovalRequiredError('Kode pembatalan sudah terpakai. Minta kode baru ke Pemilik.')
    }
    usedServerApprovals.add(approval)
    return
  }
  const row = await db.cancelCodes.get('active')
  if (!row || row.createdAt !== approval.codeCreatedAt || row.createdByUserId !== approval.approverUserId) {
    throw new OwnerApprovalRequiredError('Kode pembatalan sudah terpakai atau diganti. Minta kode baru ke Pemilik.')
  }
  await db.cancelCodes.delete('active')
}
