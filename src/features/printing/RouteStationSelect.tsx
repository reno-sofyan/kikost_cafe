import { ROUTE_STATIONS, type RouteStation } from '@/types/domain'

const ROUTE_STATION_LABELS: Record<RouteStation, string> = {
  kitchen: 'Dapur',
  bar: 'Bar',
  cashier: 'Kasir',
  direct: 'Langsung (tanpa dapur)',
}

/** Pilihan tujuan item sebuah kategori — dipakai di Produk → Kategori & Pengaturan → Printer. */
export function RouteStationSelect({
  value,
  onChange,
  className = 'input-field !w-auto !py-1',
}: {
  value: RouteStation
  onChange: (station: RouteStation) => void
  className?: string
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value as RouteStation)}>
      {ROUTE_STATIONS.map((s) => (
        <option key={s} value={s}>
          {ROUTE_STATION_LABELS[s]}
        </option>
      ))}
    </select>
  )
}
