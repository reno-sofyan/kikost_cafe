import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah } from '@/lib/currency'
import { OrderDetailPanel } from '@/features/history/OrderDetailPanel'
import { clearOrderHistory, orderDeleteBlockReason } from '@/db/repositories/orderDeletion'
import { roleHasPermission } from '@/lib/permissions'
import { useSessionStore } from '@/state/sessionStore'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { Icon } from '@/components/ui/Icon'
import { toast } from '@/state/toastStore'
import type { OrderStatus } from '@/types/domain'

const STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Terbuka',
  paid: 'Lunas',
  void: 'Dibatalkan',
  completed: 'Selesai',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  open: 'text-yellow-400',
  paid: 'text-success-500',
  void: 'text-red-400',
  completed: 'text-success-500',
}

export function HistoryScreen() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canDelete = roleHasPermission(currentUser.role, 'order.delete')
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

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

  async function handleClearHistory() {
    const all = await db.orders.toArray()
    const deletable = all.filter((o) => !orderDeleteBlockReason(o))
    if (deletable.length === 0) {
      toast.show('Tidak ada transaksi selesai yang bisa dihapus.')
      return
    }
    const openCount = all.length - deletable.length
    const ok = await confirm({
      title: `Hapus SELURUH riwayat transaksi (${deletable.length.toLocaleString('id-ID')} transaksi)?`,
      description: `Transaksi lunas, selesai, dan dibatalkan beserta pembayarannya dihapus dari semua perangkat dan laporan penjualan, dan tidak bisa dikembalikan.${
        openCount > 0 ? ` ${openCount} transaksi yang masih terbuka tidak ikut dihapus.` : ''
      } Stok tidak berubah. Tercatat di Audit Log.`,
      confirmLabel: 'Ya, Hapus Semua',
      tone: 'danger',
    })
    if (!ok) return
    const result = await clearOrderHistory({ userId: currentUser.id, userName: currentUser.name })
    setSelectedId(null)
    toast.success(`${result.deleted.toLocaleString('id-ID')} transaksi dihapus dari riwayat`)
  }

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
        {canDelete && (orders?.length ?? 0) > 0 && (
          <button className="btn-danger ml-auto" onClick={() => void handleClearHistory()}>
            <Icon name="trash" size={16} /> Hapus Semua Riwayat
          </button>
        )}
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
      {confirmDialog}
    </div>
  )
}
