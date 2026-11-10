import { describe, expect, it } from 'vitest'
import { featuresForBusinessType } from '@/lib/businessType'
import { canOpenPath, homePathFor, NAV_ITEM_DEFS, resolveNavItems, visibleNavItems } from '@/lib/navAccess'

const cafe = featuresForBusinessType('cafe_resto')
const keys = (items: { key: string }[]) => items.map((i) => i.key)

describe('navAccess', () => {
  it('tanpa pengaturan memakai bawaan peran & jenis usaha', () => {
    const items = resolveNavItems({}, featuresForBusinessType('minimarket'))
    expect(keys(visibleNavItems(items, 'kasir'))).toEqual(['kasir', 'cetak', 'riwayat', 'pelanggan', 'pengeluaran', 'shift'])
    expect(keys(visibleNavItems(items, 'administrator'))).not.toContain('meja')
    expect(items.every((i) => !i.customized)).toBe(true)
  })

  it('menu yang dimatikan hilang untuk semua peran, termasuk pemilik', () => {
    const items = resolveNavItems({ navAccess: { pelanggan: { enabled: false } } }, cafe)
    expect(keys(visibleNavItems(items, 'pemilik'))).not.toContain('pelanggan')
    expect(canOpenPath(items, 'pemilik', '/pelanggan')).toBe(false)
  })

  it('KOL & Member menu sendiri; ikut aturan Promo lama sampai diatur sendiri', () => {
    const plain = resolveNavItems({}, cafe)
    expect(keys(visibleNavItems(plain, 'administrator'))).toEqual(expect.arrayContaining(['promo', 'kol', 'member']))
    expect(canOpenPath(plain, 'administrator', '/kol')).toBe(true)

    const promoOff = resolveNavItems({ navAccess: { promo: { enabled: false } } }, cafe)
    expect(keys(visibleNavItems(promoOff, 'pemilik'))).not.toEqual(expect.arrayContaining(['kol']))
    expect(keys(visibleNavItems(promoOff, 'pemilik'))).not.toContain('member')

    const own = resolveNavItems({ navAccess: { promo: { enabled: false }, member: { enabled: true } } }, cafe)
    expect(keys(visibleNavItems(own, 'pemilik'))).toContain('member')
  })

  it('peran bisa diberi dan dicabut akses', () => {
    const items = resolveNavItems({ navAccess: { laporan: { roles: ['kasir'] }, riwayat: { roles: ['pemilik'] } } }, cafe)
    expect(canOpenPath(items, 'kasir', '/laporan/shift')).toBe(true)
    expect(canOpenPath(items, 'supervisor', '/laporan')).toBe(false)
    expect(canOpenPath(items, 'kasir', '/riwayat')).toBe(false)
  })

  it('pemilik & administrator tak bisa terkunci dari Pengaturan', () => {
    const items = resolveNavItems({ navAccess: { pengaturan: { enabled: false, roles: [] } } }, cafe)
    expect(canOpenPath(items, 'pemilik', '/pengaturan')).toBe(true)
    expect(canOpenPath(items, 'administrator', '/pengaturan')).toBe(true)
  })

  it('pelayan dari Meja tetap bisa membuka Kasir; kasir tetap bisa buka shift', () => {
    const items = resolveNavItems({ navAccess: { shift: { roles: ['pemilik'] } } }, cafe)
    expect(canOpenPath(items, 'pramusaji', '/kasir/abc/bayar')).toBe(true)
    expect(canOpenPath(items, 'kasir', '/shift')).toBe(true)
  })

  it('halaman awal = menu pertama yang boleh dibuka', () => {
    const items = resolveNavItems({}, cafe)
    expect(homePathFor(items, 'kasir')).toBe('/kasir')
    expect(homePathFor(items, 'dapur')).toBe('/dapur')
    const none = resolveNavItems({ navAccess: { dapur: { roles: [] }, cetak: { roles: [] }, absensi: { roles: [] } } }, cafe)
    expect(homePathFor(none, 'dapur')).toBeNull()
  })
})

describe('menu KOL per jenis usaha', () => {
  it('minimarket: Promo & Member tampil, KOL tidak; kafe tetap ada KOL', () => {
    const navKeys = (type: Parameters<typeof featuresForBusinessType>[0]) =>
      NAV_ITEM_DEFS.filter((n) => !n.feature || featuresForBusinessType(type)[n.feature]).map((n) => n.key)
    expect(navKeys('minimarket')).toEqual(expect.arrayContaining(['promo', 'member']))
    expect(navKeys('minimarket')).not.toContain('kol')
    expect(navKeys('cafe_resto')).toContain('kol')
  })
})
