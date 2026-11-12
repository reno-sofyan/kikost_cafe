import { beforeEach, describe, expect, it } from 'vitest'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings, getSettings, updateSettings } from './settings'

beforeEach(async () => {
  await resetLocalDb()
  await ensureDefaultSettings()
})

describe('jenis usaha dikunci setelah pengaturan awal', () => {
  it('boleh dipilih selama onboarding, lalu tak bisa diganti', async () => {
    await updateSettings({ businessType: 'kantin' })
    await updateSettings({ businessType: 'cafe_resto', onboardingCompleted: true })
    expect((await getSettings()).businessType).toBe('cafe_resto')

    await expect(updateSettings({ businessType: 'minimarket' })).rejects.toThrow('tidak bisa diubah')
    expect((await getSettings()).businessType).toBe('cafe_resto')
  })

  it('pengaturan lain tetap bisa disimpan (termasuk mengirim jenis usaha yang sama)', async () => {
    await updateSettings({ businessType: 'laundry', onboardingCompleted: true })
    await updateSettings({ businessName: 'Laundry Bersih', businessType: 'laundry' })
    expect(await getSettings()).toMatchObject({ businessName: 'Laundry Bersih', businessType: 'laundry' })
  })
})
