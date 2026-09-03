import { db } from '@/db/schema'
import type { CafeSettings } from '@/types/domain'

export const DEFAULT_SETTINGS: CafeSettings = {
  id: 'singleton',
  onboardingCompleted: false,
  cafeName: 'Kikost Cafe',
  logoDataUrl: null,
  address: '',
  phone: '',
  taxPercent: 0,
  serviceChargePercent: 0,
  roundingIncrement: 100,
  transactionPrefix: 'KKP',
  nextTransactionSequence: 1,
  blindClose: false,
  cashVarianceTolerance: 5000,
  allowPartialPayment: false,
  qrisImageDataUrl: null,
  qrisMerchantName: null,
  receiptPaperSize: '58mm',
  receiptFooterNote: 'Terima kasih atas kunjungan Anda',
  autoLockMinutes: 5,
  printerConfig: {
    connectionType: 'none',
    paperSize: '58mm',
    bluetoothAddress: null,
    bluetoothName: null,
    networkHost: null,
    networkPort: 9100,
    autoPrintOnPayment: false,
    autoPrintKitchenOrder: false,
  },
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
  updatedAt: Date.now(),
}

/**
 * Membaca pengaturan. TIDAK menulis apa pun — aman dipanggil dari dalam
 * `useLiveQuery` / transaksi read-only. Bila belum ada, kembalikan default
 * (persistensi dilakukan lewat `ensureDefaultSettings()` atau `updateSettings()`).
 */
export async function getSettings(): Promise<CafeSettings> {
  const existing = await db.settings.get('singleton')
  return existing ?? DEFAULT_SETTINGS
}

/** Menyimpan baris pengaturan default bila belum ada. Dipanggil sekali saat aplikasi start. */
export async function ensureDefaultSettings(): Promise<void> {
  const existing = await db.settings.get('singleton')
  if (!existing) {
    await db.settings.put({ ...DEFAULT_SETTINGS, updatedAt: Date.now() })
  }
}

export async function updateSettings(patch: Partial<Omit<CafeSettings, 'id'>>): Promise<CafeSettings> {
  const current = await getSettings()
  const next: CafeSettings = { ...current, ...patch, id: 'singleton', updatedAt: Date.now() }
  await db.settings.put(next)
  return next
}

/** Menghasilkan nomor transaksi berikutnya secara atomik dan menaikkan penghitung. */
export async function nextTransactionNumber(): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const current = await getSettings()
    const sequence = current.nextTransactionSequence
    await db.settings.put({ ...current, nextTransactionSequence: sequence + 1, updatedAt: Date.now() })
    const padded = String(sequence).padStart(5, '0')
    return `${current.transactionPrefix}-${padded}`
  })
}

/**
 * Rekonsiliasi penghitung nomor transaksi lokal terhadap nomor yang datang dari
 * perangkat lain saat pull. Mencegah dua perangkat menghasilkan `KKP-00042` yang
 * sama setelah keduanya online kembali. `settings` bukan entitas sync — jadi
 * penghitung tetap lokal, hanya "dikejar" ke angka tertinggi yang pernah terlihat.
 */
export async function reconcileTransactionSequence(seenNumbers: string[]): Promise<void> {
  const current = await getSettings()
  let maxSeen = 0
  for (const num of seenNumbers) {
    const m = /-(\d+)$/.exec(num)
    if (m) maxSeen = Math.max(maxSeen, Number.parseInt(m[1], 10))
  }
  if (maxSeen + 1 > current.nextTransactionSequence) {
    await db.settings.put({ ...current, nextTransactionSequence: maxSeen + 1, updatedAt: Date.now() })
  }
}
