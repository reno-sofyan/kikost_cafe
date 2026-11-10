import { CAFE_TIMEZONE } from '@/lib/datetime'

/** Urutan menu inti mode Minimarket di sidebar. */
export const RETAIL_NAV_ORDER = ['kasir', 'stok', 'pembelian', 'laporan', 'produk'] as const

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
    default:
      return { title: fallbackTitle, subtitle: null }
  }
}
