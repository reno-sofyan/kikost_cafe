import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'

const fetchSyncIdentity = vi.fn()
vi.mock('@/sync/client', () => ({ fetchSyncIdentity: () => fetchSyncIdentity() }))

const { checkTenantBinding, clearTenantBinding, getBoundTenant } = await import('./tenantGuard')
const { saveDeviceSyncConfig } = await import('./deviceConfig')
const { getLastPullAt, setLastPullAt } = await import('./device')

const identity = (tenantId: string) => ({ tenantId, businessName: tenantId, businessType: 'kantin' })

beforeEach(async () => {
  await resetLocalDb()
  localStorage.clear()
  clearTenantBinding()
  fetchSyncIdentity.mockReset()
  saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.example.com', deviceKey: 'key-kantin-0000000000' })
})

async function addOrder() {
  await db.orders.add({ id: 'o1' } as never)
}

describe('tenantGuard', () => {
  it('mengikat tenant pertama yang terverifikasi', async () => {
    fetchSyncIdentity.mockResolvedValue(identity('kantin'))
    expect((await checkTenantBinding()).ok).toBe(true)
    expect(getBoundTenant()).toBe('kantin')
  })

  it('menolak kunci tenant lain bila perangkat berisi data usaha', async () => {
    fetchSyncIdentity.mockResolvedValue(identity('kantin'))
    await checkTenantBinding()
    await addOrder()
    saveDeviceSyncConfig({ deviceKey: 'key-minimarket-000000000' })
    fetchSyncIdentity.mockResolvedValue(identity('minimarket'))
    const res = await checkTenantBinding()
    expect(res.ok).toBe(false)
    expect(getBoundTenant()).toBe('kantin')
  })

  it('perangkat tanpa transaksi boleh pindah tenant & kursor tarik direset', async () => {
    fetchSyncIdentity.mockResolvedValue(identity('kantin'))
    await checkTenantBinding()
    setLastPullAt(999)
    saveDeviceSyncConfig({ deviceKey: 'key-laundry-00000000000' })
    fetchSyncIdentity.mockResolvedValue(identity('laundry'))
    expect((await checkTenantBinding()).ok).toBe(true)
    expect(getBoundTenant()).toBe('laundry')
    expect(getLastPullAt()).toBe(0)
  })

  it('kunci baru dari tenant yang sama tetap diterima', async () => {
    fetchSyncIdentity.mockResolvedValue(identity('kafe'))
    await checkTenantBinding()
    await addOrder()
    saveDeviceSyncConfig({ deviceKey: 'key-kafe-tablet-2-00000' })
    expect((await checkTenantBinding()).ok).toBe(true)
  })

  it('server lama tanpa /whoami tidak memblokir sinkronisasi', async () => {
    fetchSyncIdentity.mockResolvedValue(null)
    expect((await checkTenantBinding()).ok).toBe(true)
    expect(getBoundTenant()).toBeNull()
  })
})
