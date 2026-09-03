import type { Permission, Role } from '@/types/domain'

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  administrator: [
    'discount.apply',
    'price.override',
    'order.void',
    'order.return',
    'refund.restock',
    'stock.adjust',
    'reports.view',
    'settings.manage',
    'users.manage',
    'shift.manage',
    'cash.variance.approve',
  ],
  supervisor: [
    'discount.apply',
    'price.override',
    'order.void',
    'order.return',
    'refund.restock',
    'stock.adjust',
    'reports.view',
    'shift.manage',
    'cash.variance.approve',
  ],
  kasir: ['discount.apply'],
  dapur: [],
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role]
}

/** Role yang PIN-nya dapat dipakai untuk menyetujui tindakan sensitif (void, retur, override harga). */
export const SUPERVISOR_APPROVAL_ROLES: Role[] = ['administrator', 'supervisor']

export const ROLE_LABELS: Record<Role, string> = {
  administrator: 'Administrator',
  supervisor: 'Supervisor',
  kasir: 'Kasir',
  dapur: 'Dapur',
}
