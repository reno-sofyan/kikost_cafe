import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { businessDisplayName, ensureDefaultSettings, getSettings, nextTransactionNumber, updateSettings } from './settings'
import { resetLocalDb } from '@/test/db'

beforeEach(async () => {
  await resetLocalDb()
})

describe('getSettings', () => {
  it('TIDAK menulis ke DB saat baris belum ada (aman untuk useLiveQuery read-only)', async () => {
    const s = await getSettings()
    expect(s.id).toBe('singleton')
    expect(await db.settings.count()).toBe(0)
  })

  // Nama usaha sengaja kosong sampai onboarding mengisinya — aplikasi dijual ke
  // banyak usaha, jadi tidak boleh ada nama bawaan yang ikut tercetak di struk.
  it('tidak punya nama usaha bawaan', async () => {
    expect((await getSettings()).businessName).toBe('')
  })

  // 'lainnya' menampilkan SEMUA fitur (lihat src/lib/businessType.ts) — default yang aman
  // untuk baris yang belum pernah lewat pemilihan jenis usaha di onboarding.
  it('jenis usaha bawaan adalah lainnya (menampilkan semua fitur)', async () => {
    expect((await getSettings()).businessType).toBe('lainnya')
  })

  it('mengembalikan baris tersimpan bila ada', async () => {
    await ensureDefaultSettings()
    await updateSettings({ businessName: 'Kafe Uji' })
    expect((await getSettings()).businessName).toBe('Kafe Uji')
  })
})

describe('businessDisplayName', () => {
  it('memakai nama usaha bila terisi', () => {
    expect(businessDisplayName({ businessName: 'Kopi Senja' })).toBe('Kopi Senja')
  })

  it('jatuh ke nama produk saat kosong, null, atau hanya spasi', () => {
    expect(businessDisplayName({ businessName: '' })).toBe('Kione POS')
    expect(businessDisplayName({ businessName: '   ' })).toBe('Kione POS')
    expect(businessDisplayName(null)).toBe('Kione POS')
    expect(businessDisplayName(undefined)).toBe('Kione POS')
  })
})

describe('ensureDefaultSettings', () => {
  it('membuat baris sekali, idempoten', async () => {
    await ensureDefaultSettings()
    await ensureDefaultSettings()
    expect(await db.settings.count()).toBe(1)
  })
})

describe('nextTransactionNumber', () => {
  it('menghasilkan nomor berurutan dan menaikkan penghitung', async () => {
    const a = await nextTransactionNumber()
    const b = await nextTransactionNumber()
    expect(a).toMatch(/-00001$/)
    expect(b).toMatch(/-00002$/)
    expect((await getSettings()).nextTransactionSequence).toBe(3)
  })
})
