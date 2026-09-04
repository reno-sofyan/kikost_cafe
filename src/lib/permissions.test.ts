import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, permissionsForRole, roleHasPermission, SUPERVISOR_APPROVAL_ROLES } from './permissions'

describe('roleHasPermission', () => {
  it('administrator memiliki semua izin sensitif', () => {
    for (const p of ['order.void', 'order.return', 'price.override', 'settings.manage', 'users.manage'] as const) {
      expect(roleHasPermission('administrator', p)).toBe(true)
    }
  })

  it('kasir hanya diskon + retry cetak, tidak boleh void / override / laporan', () => {
    expect(roleHasPermission('kasir', 'discount.apply')).toBe(true)
    expect(roleHasPermission('kasir', 'print.retry')).toBe(true)
    expect(roleHasPermission('kasir', 'order.void')).toBe(false)
    expect(roleHasPermission('kasir', 'price.override')).toBe(false)
    expect(roleHasPermission('kasir', 'reports.view')).toBe(false)
    expect(roleHasPermission('kasir', 'users.manage')).toBe(false)
    expect(roleHasPermission('kasir', 'printer.manage')).toBe(false)
    expect(roleHasPermission('kasir', 'receipt.reprint')).toBe(false)
  })

  it('dapur hanya boleh retry cetak (tiket dapur macet)', () => {
    expect(permissionsForRole('dapur')).toEqual(['print.retry'])
  })

  it('kasir boleh menerima/menolak pesanan QR, tapi tidak kelola meja & QR', () => {
    expect(roleHasPermission('kasir', 'qr.order.confirm')).toBe(true)
    expect(roleHasPermission('kasir', 'qr.manage')).toBe(false)
    expect(roleHasPermission('administrator', 'qr.manage')).toBe(true)
    expect(roleHasPermission('supervisor', 'qr.manage')).toBe(true)
  })

  it('supervisor bisa menyetujui tindakan sensitif tapi tidak kelola pengguna/pengaturan', () => {
    expect(roleHasPermission('supervisor', 'order.void')).toBe(true)
    expect(roleHasPermission('supervisor', 'users.manage')).toBe(false)
    expect(roleHasPermission('supervisor', 'settings.manage')).toBe(false)
  })

  it('pemilik, administrator & supervisor bisa jadi approver', () => {
    expect(SUPERVISOR_APPROVAL_ROLES).toEqual(['pemilik', 'administrator', 'supervisor'])
  })

  it('pemilik punya akses penuh', () => {
    expect(permissionsForRole('pemilik')).toEqual(ALL_PERMISSIONS)
  })

  it('pramusaji: terima/tolak QR + sesi meja + retry cetak, tanpa kas/diskon/void', () => {
    expect(roleHasPermission('pramusaji', 'qr.order.confirm')).toBe(true)
    expect(roleHasPermission('pramusaji', 'tablesession.manage')).toBe(true)
    expect(roleHasPermission('pramusaji', 'print.retry')).toBe(true)
    expect(roleHasPermission('pramusaji', 'discount.apply')).toBe(false)
    expect(roleHasPermission('pramusaji', 'order.void')).toBe(false)
    expect(roleHasPermission('pramusaji', 'qr.manage')).toBe(false)
  })
})
