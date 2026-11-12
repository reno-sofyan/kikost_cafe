import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetLocalDb } from '@/test/db'
import { db } from '@/db/schema'
import { useDeveloperStore } from '@/state/developerStore'
import { useSessionStore } from '@/state/sessionStore'
import type { User } from '@/types/domain'

const consume = vi.fn()
let configured = true
vi.mock('@/sync/client', () => ({ consumeServerDeveloperCode: (code: string) => consume(code) }))
vi.mock('@/sync/deviceConfig', () => ({ isBackendConfigured: () => configured }))

const { unlockDeveloperMode } = await import('./developerAccess')
const actor = { userId: 'u1', userName: 'Reno' }

beforeEach(async () => {
  await resetLocalDb()
  consume.mockReset()
  configured = true
  useDeveloperStore.getState().lock()
})

describe('Mode Developer (token 4 angka dari /ops)', () => {
  it('token benar membuka Mode Developer & tercatat', async () => {
    consume.mockResolvedValue({ ok: true, createdAt: 1 })
    expect(await unlockDeveloperMode('0427', actor)).toEqual({ ok: true })
    expect(consume).toHaveBeenCalledWith('0427')
    expect(useDeveloperStore.getState().unlocked).toBe(true)
    expect(await db.auditLogs.where('action').equals('developer.unlock').count()).toBe(1)
  })

  it('token salah, hangus, kedaluwarsa → tetap terkunci dengan pesan jelas', async () => {
    consume.mockResolvedValueOnce({ ok: false, reason: 'invalid', attemptsLeft: 3 })
    expect(await unlockDeveloperMode('1111', actor)).toEqual({ ok: false, message: 'Token salah. Sisa percobaan: 3.' })
    consume.mockResolvedValueOnce({ ok: false, reason: 'burned' })
    expect((await unlockDeveloperMode('1111', actor)) as { message: string }).toMatchObject({ message: expect.stringContaining('hangus') })
    consume.mockResolvedValueOnce({ ok: false, reason: 'expired' })
    expect((await unlockDeveloperMode('1111', actor)) as { message: string }).toMatchObject({ message: expect.stringContaining('kedaluwarsa') })
    expect(useDeveloperStore.getState().unlocked).toBe(false)
    expect(await db.auditLogs.where('action').equals('developer.unlock_failed').count()).toBe(3)
  })

  it('format salah, tanpa server, atau offline → tak memanggil/menolak dengan jelas', async () => {
    expect(await unlockDeveloperMode('12a', actor)).toMatchObject({ ok: false })
    configured = false
    expect((await unlockDeveloperMode('1234', actor)) as { message: string }).toMatchObject({ message: expect.stringContaining('belum terhubung') })
    configured = true
    consume.mockRejectedValueOnce(new Error('network'))
    expect((await unlockDeveloperMode('1234', actor)) as { message: string }).toMatchObject({ message: expect.stringContaining('internet') })
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('keluar akun, ganti akun, atau layar terkunci → perlu token baru', async () => {
    const user = { id: 'u1', name: 'Reno', role: 'pemilik' } as User
    for (const end of [() => useSessionStore.getState().logout(), () => useSessionStore.getState().lock(), () => useSessionStore.getState().login(user)]) {
      useDeveloperStore.getState().unlock()
      end()
      expect(useDeveloperStore.getState().unlocked).toBe(false)
    }
  })
})
