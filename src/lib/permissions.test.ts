import { describe, expect, it } from 'vitest'
import { permissionsForRole, roleHasPermission, SUPERVISOR_APPROVAL_ROLES } from './permissions'

describe('roleHasPermission', () => {
  it('administrator memiliki semua izin sensitif', () => {
    for (const p of ['order.void', 'order.return', 'price.override', 'settings.manage', 'users.manage'] as const) {
      expect(roleHasPermission('administrator', p)).toBe(true)
    }
  })

  it('kasir hanya boleh menerapkan diskon, tidak boleh void / override / laporan', () => {
    expect(roleHasPermission('kasir', 'discount.apply')).toBe(true)
    expect(roleHasPermission('kasir', 'order.void')).toBe(false)
    expect(roleHasPermission('kasir', 'price.override')).toBe(false)
    expect(roleHasPermission('kasir', 'reports.view')).toBe(false)
    expect(roleHasPermission('kasir', 'users.manage')).toBe(false)
  })

  it('dapur tidak punya izin apa pun', () => {
    expect(permissionsForRole('dapur')).toHaveLength(0)
  })

  it('supervisor bisa menyetujui tindakan sensitif tapi tidak kelola pengguna/pengaturan', () => {
    expect(roleHasPermission('supervisor', 'order.void')).toBe(true)
    expect(roleHasPermission('supervisor', 'users.manage')).toBe(false)
    expect(roleHasPermission('supervisor', 'settings.manage')).toBe(false)
  })

  it('hanya administrator & supervisor yang bisa jadi approver', () => {
    expect(SUPERVISOR_APPROVAL_ROLES).toEqual(['administrator', 'supervisor'])
  })
})
