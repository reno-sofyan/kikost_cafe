import type { Permission, Role } from '@/types/domain'

/** Semua izin yang ada — dipakai untuk role pemilik (akses penuh). */
export const ALL_PERMISSIONS: Permission[] = [
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
  'printer.manage',
  'print.retry',
  'receipt.reprint',
  'kitchen.ticket.cancel',
  'qr.manage',
  'qr.order.confirm',
  'tablesession.manage',
]

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  pemilik: [...ALL_PERMISSIONS],
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
    'printer.manage',
    'print.retry',
    'receipt.reprint',
    'kitchen.ticket.cancel',
    'qr.manage',
    'qr.order.confirm',
    'tablesession.manage',
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
    'printer.manage',
    'print.retry',
    'receipt.reprint',
    'kitchen.ticket.cancel',
    'qr.manage',
    'qr.order.confirm',
    'tablesession.manage',
  ],
  kasir: ['discount.apply', 'print.retry', 'qr.order.confirm', 'tablesession.manage'],
  pramusaji: ['print.retry', 'qr.order.confirm', 'tablesession.manage'],
  dapur: ['print.retry'],
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role]
}

/** Role yang PIN-nya dapat dipakai untuk menyetujui tindakan sensitif (void, retur, override harga). */
export const SUPERVISOR_APPROVAL_ROLES: Role[] = ['pemilik', 'administrator', 'supervisor']

export const ROLE_LABELS: Record<Role, string> = {
  pemilik: 'Pemilik',
  administrator: 'Administrator',
  supervisor: 'Supervisor',
  kasir: 'Kasir',
  pramusaji: 'Pramusaji',
  dapur: 'Dapur',
}
