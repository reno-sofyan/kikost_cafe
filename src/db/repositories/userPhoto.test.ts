import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { createUser, updateUser, verifyUserPin } from './users'

const PHOTO = 'data:image/jpeg;base64,AAAA'
const actor = { userId: 'admin', userName: 'Admin' }

beforeEach(async () => {
  await resetLocalDb()
})

describe('foto profil pengguna', () => {
  it('bisa diisi saat dibuat, diganti, dan dihapus — PIN tetap berlaku', async () => {
    const u = await createUser({ name: 'Rina', role: 'kasir', pin: '1357', photoDataUrl: PHOTO }, actor)
    expect((await db.users.get(u.id))?.photoDataUrl).toBe(PHOTO)

    await updateUser(u.id, { photoDataUrl: 'data:image/jpeg;base64,BBBB' }, actor)
    expect((await db.users.get(u.id))?.photoDataUrl).toBe('data:image/jpeg;base64,BBBB')
    await updateUser(u.id, { photoDataUrl: null }, actor)
    expect((await db.users.get(u.id))?.photoDataUrl).toBeNull()

    expect(await verifyUserPin(u.id, '1357')).not.toBeNull()
    const logs = (await db.auditLogs.where('action').equals('user.update').toArray()).map((l) => l.details)
    expect(logs.some((d) => d.includes('foto profil diganti'))).toBe(true)
    expect(logs.some((d) => d.includes('foto profil dihapus'))).toBe(true)
  })

  it('pengguna lama tanpa kolom foto tetap valid', async () => {
    const u = await createUser({ name: 'Andi', role: 'dapur', pin: '2468' })
    expect((await db.users.get(u.id))?.photoDataUrl ?? null).toBeNull()
  })
})
