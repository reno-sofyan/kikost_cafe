import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { ensureDefaultSettings, getSettings, nextTransactionNumber, updateSettings } from './settings'
import { resetLocalDb } from '@/test/db'

beforeEach(async () => {
  await resetLocalDb()
})

describe('getSettings', () => {
  it('TIDAK menulis ke DB saat baris belum ada (aman untuk useLiveQuery read-only)', async () => {
    const s = await getSettings()
    expect(s.cafeName).toBeTruthy()
    expect(await db.settings.count()).toBe(0)
  })

  it('mengembalikan baris tersimpan bila ada', async () => {
    await ensureDefaultSettings()
    await updateSettings({ cafeName: 'Kafe Uji' })
    expect((await getSettings()).cafeName).toBe('Kafe Uji')
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
