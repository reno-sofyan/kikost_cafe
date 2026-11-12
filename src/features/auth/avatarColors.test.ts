import { describe, expect, it } from 'vitest'
import { AVATAR_CLASSES, accountInitials, avatarClassFor, lastLoginLabel } from './avatarColors'

describe('warna avatar akun', () => {
  it('tetap untuk nama yang sama (tak peduli spasi/huruf besar)', () => {
    expect(avatarClassFor('Budi Santoso')).toBe(avatarClassFor('  budi santoso '))
    expect(AVATAR_CLASSES).toContain(avatarClassFor('Budi Santoso'))
  })
  it('nama berbeda tersebar ke beberapa warna', () => {
    const names = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eka', 'Fajar', 'Gita', 'Hadi', 'Indah', 'Joko']
    expect(new Set(names.map(avatarClassFor)).size).toBeGreaterThanOrEqual(4)
  })
  it('inisial dua huruf, aman untuk nama kosong', () => {
    expect(accountInitials('kece visual coffee')).toBe('KV')
    expect(accountInitials('Rina')).toBe('R')
    expect(accountInitials('   ')).toBe('?')
  })
  it('label terakhir masuk', () => {
    const now = 10 * 86_400_000
    expect(lastLoginLabel(null, now)).toBeNull()
    expect(lastLoginLabel(now - 30_000, now)).toBe('Baru saja masuk')
    expect(lastLoginLabel(now - 5 * 60_000, now)).toBe('Masuk 5 menit lalu')
    expect(lastLoginLabel(now - 3 * 3_600_000, now)).toBe('Masuk 3 jam lalu')
    expect(lastLoginLabel(now - 86_400_000, now)).toBe('Masuk kemarin')
  })
})
