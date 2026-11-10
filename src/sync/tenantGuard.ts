import { db } from '@/db/schema'
import { fetchSyncIdentity, type SyncIdentity } from '@/sync/client'
import { getApiBaseUrl, getDeviceKey } from '@/sync/deviceConfig'
import { setLastPullAt } from '@/sync/device'

/**
 * Pengikatan data lokal ke satu tenant server.
 *
 * Satu perangkat = satu usaha. Server sudah memisahkan data per tenant (kunci
 * perangkat → tenant), tetapi tablet dulu tak pernah memeriksa kunci yang dipakai:
 * mengganti kunci ke usaha lain (mis. dari Kantin ke Minimarket) lalu "sinkron ulang
 * penuh" mendorong SELURUH data lokal usaha lama ke tenant baru, dan menarik data
 * tenant baru ke database yang sama — dua usaha bercampur.
 *
 * Aturannya sekarang: tenant pertama yang terverifikasi diikat ke perangkat ini.
 * Kunci milik tenant lain hanya diterima bila perangkat belum berisi data usaha
 * (tablet baru); selain itu sinkronisasi dihentikan sampai data lokal direset.
 */
const BOUND_TENANT_KEY = 'kione.sync.boundTenant'

export type TenantCheck =
  | { ok: true; identity: SyncIdentity | null }
  | { ok: false; boundTenant: string; identity: SyncIdentity }

export class TenantMismatchError extends Error {
  constructor(public identity: SyncIdentity) {
    super(
      `Kunci perangkat ini milik usaha lain${identity.businessName ? ` ("${identity.businessName}")` : ''}. ` +
        'Sinkronisasi dihentikan supaya data usaha di perangkat ini tidak tercampur. Buka Pengaturan → Sinkronisasi.',
    )
    this.name = 'TenantMismatchError'
  }
}

export function getBoundTenant(): string | null {
  try {
    return localStorage.getItem(BOUND_TENANT_KEY)
  } catch {
    return null
  }
}

function bindTenant(tenantId: string): void {
  try {
    localStorage.setItem(BOUND_TENANT_KEY, tenantId)
  } catch {
    /* tanpa localStorage, pengecekan diulang tiap siklus — tetap aman */
  }
}

export function clearTenantBinding(): void {
  try {
    localStorage.removeItem(BOUND_TENANT_KEY)
  } catch {
    /* abaikan */
  }
  verified = null
}

/** Perangkat sudah berisi data usaha (bukan sekadar katalog contoh onboarding). */
export async function localHasBusinessData(): Promise<boolean> {
  if ((await db.orders.count()) > 0) return true
  if ((await db.shifts.count()) > 0) return true
  if ((await db.purchases.count()) > 0) return true
  return (await db.stockMovements.count()) > 0
}

/** Identitas backend (URL|kunci) yang sudah lolos pengecekan — hindari memanggil server tiap siklus. */
let verified: string | null = null

export async function checkTenantBinding(): Promise<TenantCheck> {
  const identityKey = `${getApiBaseUrl()}|${getDeviceKey()}`
  if (verified === identityKey) return { ok: true, identity: null }
  const identity = await fetchSyncIdentity()
  // Server lama tanpa /whoami: tak bisa diverifikasi — perilaku lama dipertahankan.
  if (!identity) return { ok: true, identity: null }
  const bound = getBoundTenant()
  if (bound && bound !== identity.tenantId) {
    if (await localHasBusinessData()) return { ok: false, boundTenant: bound, identity }
    // Tablet tanpa transaksi pindah usaha: mulai tarik data tenant baru dari awal
    // (kursor tarik milik tenant lama bisa melewatkan data tenant baru).
    setLastPullAt(0)
  }
  bindTenant(identity.tenantId)
  verified = identityKey
  return { ok: true, identity }
}

/** Untuk mesin sinkronisasi: lempar bila kunci milik tenant lain. */
export async function assertTenantBinding(): Promise<void> {
  const res = await checkTenantBinding()
  if (!res.ok) throw new TenantMismatchError(res.identity)
}

/**
 * Pindah usaha: hapus SELURUH data lokal (database + status sinkronisasi) lalu muat
 * ulang ke onboarding. Pengguna diminta backup dulu di layar pemanggil.
 */
export async function wipeLocalDataForNewTenant(): Promise<void> {
  db.close()
  await db.delete()
  clearTenantBinding()
  setLastPullAt(0)
  try {
    localStorage.removeItem('kione.sync.fullResyncFor')
  } catch {
    /* abaikan */
  }
  window.location.reload()
}
