import { CAFE_TIMEZONE } from '@/lib/datetime'

/** Urutan menu mode Minimarket di sidebar: alur kasir → barang → pelanggan → kontrol. */
export const RETAIL_NAV_ORDER = ['kasir', 'riwayat', 'stok', 'pembelian', 'produk', 'pelanggan', 'promo', 'laporan', 'shift', 'pengeluaran'] as const

/**
 * Menu yang tak ditampilkan di sidebar Minimarket (rutenya tetap bisa dibuka):
 * Antrean Cetak lewat Pengaturan → Printer, Member lewat tab di halaman Promo.
 */
export const RETAIL_NAV_HIDDEN: readonly string[] = ['cetak', 'member']

const DAY_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: CAFE_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "Senin, 3 Nov 2026" */
export function retailDayLabel(now: number): string {
  return DAY_FORMATTER.format(new Date(now))
}

/** Judul & subjudul header mode Minimarket per halaman. */
export function retailPageHeading(pathname: string, fallbackTitle: string, now: number): { title: string; subtitle: string | null } {
  const segment = pathname.split('/')[1] ?? ''
  switch (segment) {
    case 'kasir':
      return { title: 'Kasir', subtitle: `Minimarket · ${retailDayLabel(now)}` }
    case 'stok':
      return { title: 'Stok Minimarket', subtitle: 'Pantau stok dan atur penyesuaian barang' }
    case 'pembelian':
      return { title: 'Pembelian', subtitle: 'Pesanan ke pemasok dan penerimaan barang' }
    case 'produk':
      return { title: 'Produk', subtitle: 'Kelola katalog produk' }
    case 'laporan':
      return { title: 'Laporan', subtitle: 'Ringkasan penjualan dan nota' }
    case 'riwayat':
      return { title: 'Riwayat Transaksi', subtitle: 'Cetak ulang struk, retur, dan pembatalan' }
    case 'pelanggan':
      return { title: 'Pelanggan', subtitle: 'Data pelanggan dan member' }
    case 'promo':
    case 'member':
      return { title: 'Promo & Member', subtitle: 'Promo otomatis, voucher, dan program poin' }
    case 'shift':
      return { title: 'Shift Kasir', subtitle: 'Buka/tutup kas dan setoran' }
    case 'pengeluaran':
      return { title: 'Pengeluaran', subtitle: 'Uang keluar dari kas toko' }
    case 'cetak':
      return { title: 'Antrean Cetak', subtitle: 'Status struk yang dikirim ke printer' }
    case 'pengaturan':
      return { title: 'Pengaturan', subtitle: null }
    default:
      return { title: fallbackTitle, subtitle: null }
  }
}
