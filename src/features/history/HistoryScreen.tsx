import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah } from '@/lib/currency'
import { OrderDetailPanel } from '@/features/history/OrderDetailPanel'
import type { OrderStatus } from '@/types/domain'

const STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Terbuka',
  paid: 'Lunas',
  void: 'Dibatalkan',
  completed: 'Selesai',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  open: 'text-yellow-400',
  paid: 'text-sage-500',
  void: 'text-red-400',
  completed: 'text-sage-500',
}

export function HistoryScreen() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const orders = useLiveQuery(() => db.orders.orderBy('createdAt').reverse().limit(500).toArray(), [])
  const selectedOrder = useLiveQuery(() => (selectedId ? db.orders.get(selectedId) : undefined), [selectedId])

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase()
    return (orders ?? []).filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (!lowered) return true
      return o.orderNumber.toLowerCase().includes(lowered) || o.cashierName.toLowerCase().includes(lowered)
    })
  }, [orders, search, statusFilter])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-ink-800 px-6 py-4">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Riwayat Transaksi</h1>
        <input
          className="input-field max-w-xs"
          placeholder="Cari nomor transaksi/kasir..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input-field max-w-[10rem]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}>
          <option value="all">Semua Status</option>
          <option value="paid">Lunas</option>
          <option value="open">Terbuka</option>
          <option value="void">Dibatalkan</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {filtered.map((order) => (
            <button key={order.id} onClick={() => setSelectedId(order.id)} className="card flex w-full items-center justify-between p-4 text-left">
              <div>
                <p className="font-semibold text-ink-50">{order.orderNumber}</p>
                <p className="text-sm text-ink-400">
                  {order.cashierName} • {formatDateTime(order.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-ink-50">{formatRupiah(order.grandTotal)}</p>
                <p className={`text-sm ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="mt-10 text-center text-ink-500">Tidak ada transaksi</p>}
        </div>
      </div>

      {selectedOrder && <OrderDetailPanel order={selectedOrder} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
