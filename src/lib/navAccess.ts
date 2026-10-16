import type { IconName } from '@/components/ui/Icon'
import { roleHasPermission } from '@/lib/permissions'
import type { BusinessFeatures } from '@/lib/businessType'
import type { AppSettings, Permission, Role } from '@/types/domain'

export const ALL_ROLES: Role[] = ['pemilik', 'administrator', 'supervisor', 'kasir', 'pramusaji', 'dapur']

/** Peran yang membuka/menutup shift — juga yang menerima pengingat shift 21.00. */
export const SHIFT_ROLES: Role[] = ['pemilik', 'administrator', 'supervisor', 'kasir']

export type NavKey =
  | 'kasir'
  | 'pesanan-qr'
  | 'meja'
  | 'dapur'
  | 'cetak'
  | 'riwayat'
  | 'pelanggan'
  | 'pengeluaran'
  | 'laporan'
  | 'promo'
  | 'produk'
  | 'stok'
  | 'shift'
  | 'absensi'
  | 'pengaturan'

export interface NavItemDef {
  key: NavKey
  to: string
  label: string
  icon: IconName
  description: string
  /** Peran yang boleh membuka menu ini bila pemilik belum mengubahnya. */
  defaultRoles: Role[]
  /** Menu ini aktif bawaan hanya bila fitur jenis usaha ini menyala. */
  feature?: keyof BusinessFeatures
  /** Menu wajib — tak bisa dimatikan (mis. Pengaturan, supaya tak ada yang terkunci di luar). */
  required?: boolean
}

const rolesWith = (permission: Permission) => ALL_ROLES.filter((r) => roleHasPermission(r, permission))
const FRONT_ROLES: Role[] = ['pemilik', 'administrator', 'supervisor', 'kasir']

export const NAV_ITEM_DEFS: NavItemDef[] = [
  { key: 'kasir', to: '/kasir', label: 'Kasir', icon: 'cart', description: 'Membuat pesanan & menerima pembayaran.', defaultRoles: FRONT_ROLES },
  { key: 'pesanan-qr', to: '/pesanan-qr', label: 'Pesanan QR', icon: 'bell', description: 'Menerima pesanan yang dikirim pelanggan dari QR meja.', defaultRoles: [...FRONT_ROLES, 'pramusaji'], feature: 'qrOrdering' },
  { key: 'meja', to: '/meja', label: 'Meja', icon: 'table', description: 'Denah meja, reservasi & pesanan terjadwal.', defaultRoles: [...FRONT_ROLES, 'pramusaji'], feature: 'tables' },
  { key: 'dapur', to: '/dapur', label: 'Dapur', icon: 'chef', description: 'Layar dapur/bar untuk menyiapkan pesanan.', defaultRoles: ALL_ROLES, feature: 'kitchen' },
  { key: 'cetak', to: '/cetak', label: 'Cetak', icon: 'printer', description: 'Antrean cetak struk & tiket dapur.', defaultRoles: ALL_ROLES },
  { key: 'riwayat', to: '/riwayat', label: 'Riwayat', icon: 'clock', description: 'Daftar transaksi, cetak ulang, retur & pembatalan.', defaultRoles: FRONT_ROLES },
  { key: 'pelanggan', to: '/pelanggan', label: 'Pelanggan', icon: 'user', description: 'Data pelanggan & member.', defaultRoles: FRONT_ROLES },
  { key: 'pengeluaran', to: '/pengeluaran', label: 'Pengeluaran', icon: 'wallet', description: 'Mencatat uang keluar dari kas.', defaultRoles: FRONT_ROLES },
  { key: 'laporan', to: '/laporan', label: 'Laporan', icon: 'chart', description: 'Laporan penjualan, shift & keuangan.', defaultRoles: rolesWith('reports.view') },
  { key: 'promo', to: '/promo', label: 'Promo', icon: 'star', description: 'Promo otomatis, voucher & KOL.', defaultRoles: rolesWith('settings.manage'), feature: 'promos' },
  { key: 'produk', to: '/produk', label: 'Produk', icon: 'coffee', description: 'Produk, kategori, modifier & paket.', defaultRoles: rolesWith('settings.manage') },
  { key: 'stok', to: '/stok', label: 'Stok', icon: 'box', description: 'Stok, bahan baku & produksi.', defaultRoles: rolesWith('stock.adjust') },
  { key: 'shift', to: '/shift', label: 'Shift', icon: 'cashDrawer', description: 'Buka & tutup shift, hitung kas.', defaultRoles: SHIFT_ROLES },
  { key: 'absensi', to: '/absensi', label: 'Absensi', icon: 'checkCircle', description: 'Absen masuk/pulang karyawan & rekap gaji.', defaultRoles: ALL_ROLES, feature: 'attendance' },
  { key: 'pengaturan', to: '/pengaturan', label: 'Pengaturan', icon: 'settings', description: 'Pengaturan usaha, printer, pengguna, dll.', defaultRoles: rolesWith('settings.manage'), required: true },
]

/**
 * Peran yang selalu punya akses ke menu yang aktif. Pemilik & Administrator yang
 * mengatur halaman ini — mereka tak boleh bisa mengunci dirinya sendiri dari Pengaturan.
 */
export function lockedRolesFor(def: NavItemDef): Role[] {
  if (def.key === 'pengaturan') return ['pemilik', 'administrator']
  return def.defaultRoles.includes('pemilik') ? ['pemilik'] : []
}

export interface NavAccessRule {
  enabled?: boolean
  roles?: Role[]
}

export type NavAccessConfig = Partial<Record<NavKey, NavAccessRule>>

export interface ResolvedNavItem extends NavItemDef {
  enabled: boolean
  roles: Role[]
  /** True bila aktif/peran berbeda dari bawaan (untuk label "diubah"). */
  customized: boolean
}

export function resolveNavItems(
  settings: Pick<AppSettings, 'navAccess'> | null | undefined,
  features: BusinessFeatures,
): ResolvedNavItem[] {
  const config = settings?.navAccess ?? {}
  return NAV_ITEM_DEFS.map((def) => {
    const rule = config[def.key] ?? {}
    const defaultEnabled = def.feature ? !!features[def.feature] : true
    const enabled = def.required ? true : (rule.enabled ?? defaultEnabled)
    const locked = lockedRolesFor(def)
    const chosen = rule.roles ?? def.defaultRoles
    const roles = ALL_ROLES.filter((r) => chosen.includes(r) || locked.includes(r))
    const customized =
      enabled !== defaultEnabled ||
      roles.length !== def.defaultRoles.length ||
      roles.some((r) => !def.defaultRoles.includes(r))
    return { ...def, enabled, roles, customized }
  })
}

export function visibleNavItems(items: ResolvedNavItem[], role: Role): ResolvedNavItem[] {
  return items.filter((i) => i.enabled && i.roles.includes(role))
}

/**
 * Rute yang ikut terbuka lewat menu lain: dari Meja pelayan membuka Kasir untuk
 * menambah item, dan Kasir butuh shift terbuka untuk bisa berjualan.
 */
const COMPANION_ROUTES: Partial<Record<NavKey, NavKey[]>> = {
  kasir: ['meja'],
  shift: ['kasir'],
}

/** Kunci menu untuk sebuah path (`/kasir/abc/bayar` → `kasir`). Null = bukan rute menu. */
export function navKeyForPath(pathname: string): NavKey | null {
  const segment = pathname.split('/')[1] ?? ''
  return NAV_ITEM_DEFS.find((d) => d.to === `/${segment}`)?.key ?? null
}

export function canOpenPath(items: ResolvedNavItem[], role: Role, pathname: string): boolean {
  const key = navKeyForPath(pathname)
  if (!key) return true
  const allowed = new Set(visibleNavItems(items, role).map((i) => i.key))
  return allowed.has(key) || (COMPANION_ROUTES[key] ?? []).some((k) => allowed.has(k))
}

/** Halaman awal peran ini: menu pertama yang boleh dibuka. Null = tak ada menu sama sekali. */
export function homePathFor(items: ResolvedNavItem[], role: Role): string | null {
  return visibleNavItems(items, role)[0]?.to ?? null
}
