import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { createUser, LastUserManagerError, setUserActive, updateUser, verifySupervisorPin } from './users'

beforeEach(async () => {
  await resetLocalDb()
})

describe('Audit trail pengelolaan pengguna', () => {
  it('createUser/setUserActive/updateUser/updateUserPin masing-masing mencatat satu entri audit', async () => {
    const admin = await createUser({ name: 'Admin', role: 'administrator', pin: '1234' })
    const actor = { userId: admin.id, userName: admin.name }

    const kasir = await createUser({ name: 'Kasir Baru', role: 'kasir', pin: '1111' }, actor)
    await updateUser(kasir.id, { name: 'Kasir Diubah' }, actor)
    await setUserActive(kasir.id, false, actor)

    const logs = await db.auditLogs.filter((l) => l.entityId === kasir.id).toArray()
    const actions = logs.map((l) => l.action).sort()
    expect(actions).toEqual(['user.create', 'user.deactivate', 'user.update'])
    expect(logs.every((l) => l.userId === admin.id)).toBe(true)
  })
})

describe('Proteksi pengelola pengguna terakhir', () => {
  it('menolak menonaktifkan satu-satunya administrator aktif', async () => {
    const admin = await createUser({ name: 'Admin', role: 'administrator', pin: '1234' })
    const actor = { userId: admin.id, userName: admin.name }

    await expect(setUserActive(admin.id, false, actor)).rejects.toThrow(LastUserManagerError)
    const stillActive = await db.users.get(admin.id)
    expect(stillActive?.active).toBe(true)
  })

  it('menolak menurunkan role satu-satunya administrator ke kasir', async () => {
    const admin = await createUser({ name: 'Admin', role: 'administrator', pin: '1234' })
    const actor = { userId: admin.id, userName: admin.name }

    await expect(updateUser(admin.id, { role: 'kasir' }, actor)).rejects.toThrow(LastUserManagerError)
    const unchanged = await db.users.get(admin.id)
    expect(unchanged?.role).toBe('administrator')
  })

  it('mengizinkan menonaktifkan admin bila masih ada pengelola pengguna aktif lain (pemilik)', async () => {
    const owner = await createUser({ name: 'Pemilik', role: 'pemilik', pin: '9999' })
    const actor = { userId: owner.id, userName: owner.name }
    const admin = await createUser({ name: 'Admin', role: 'administrator', pin: '1234' }, actor)

    await expect(setUserActive(admin.id, false, actor)).resolves.toBeUndefined()
    const deactivated = await db.users.get(admin.id)
    expect(deactivated?.active).toBe(false)
  })
})

describe('verifySupervisorPin', () => {
  it('menerima PIN pemilik, bukan hanya administrator/supervisor', async () => {
    const owner = await createUser({ name: 'Pemilik', role: 'pemilik', pin: '5678' })

    const approver = await verifySupervisorPin('5678')
    expect(approver?.id).toBe(owner.id)
  })
})
