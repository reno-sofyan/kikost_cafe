import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { cancelEmptyOrder, listOpenOrders, listOrderItems } from '@/db/repositories/orders'
import { useSessionStore } from '@/state/sessionStore'
import { formatRupiah } from '@/lib/currency'
import { durationSince, formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { toast } from '@/state/toastStore'
import type { Order } from '@/types/domain'

const ORDER_TYPE_LABELS: Record<Order['type'], string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

interface Props {
  /** Kantin: pisahkan bill gantung ke tab sendiri. */
  showPayLater?: boolean
  onSelect: (orderId: string) => void
  onClose: () => void
}

export function OpenBillsDrawer({ showPayLater = false, onSelect, onClose }: Props) {
  const allOpen = useLiveQuery(() => listOpenOrders(), []) ?? []
  const currentUser = useSessionStore((s) => s.currentUser)!
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const [tab, setTab] = useState<'open' | 'payLater'>('open')
  const payLaterOrders = showPayLater ? allOpen.filter((o) => o.payLater) : []
  const openOrders = showPayLater && tab === 'payLater' ? payLaterOrders : allOpen.filter((o) => !showPayLater || !o.payLater)
  const payLaterTotal = payLaterOrders.reduce((sum, o) => sum + o.grandTotal, 0)

  return (
    <Modal onClose={onClose} align="end" className="flex h-full w-full max-w-sm flex-col bg-ink-900">
        <div className="flex flex-none items-center justify-between border-b border-ink-800 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-50">Pesanan Terbuka</h2>
          <button className="btn-ghost btn-compact !px-3" aria-label="Tutup" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {showPayLater && (
          <div className="flex flex-none gap-2 border-b border-ink-800 px-4 py-2">
            <button className={`btn btn-compact flex-1 text-sm ${tab === 'open' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('open')}>
              Terbuka
            </button>
            <button className={`btn btn-compact flex-1 text-sm ${tab === 'payLater' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('payLater')}>
              Bill Gantung ({payLaterOrders.length})
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {showPayLater && tab === 'payLater' && payLaterOrders.length > 0 && (
            <div className="mb-3 flex justify-between rounded-xl bg-ink-800 px-4 py-2 text-sm">
              <span className="text-ink-400">Total belum dibayar</span>
              <span className="font-bold text-ink-50">{formatRupiah(payLaterTotal)}</span>
            </div>
          )}
          {openOrders.length === 0 && (
            <p className="text-center text-sm text-ink-500">{tab === 'payLater' ? 'Tidak ada bill gantung' : 'Tidak ada pesanan terbuka'}</p>
          )}
          <div className="space-y-2">
            {openOrders.map((order) => (
              <OpenBillRow
                key={order.id}
                order={order}
                onSelect={() => onSelect(order.id)}
                onCancel={async () => {
                  const ok = await confirm({
                    title: 'Batalkan Pesanan Kosong?',
                    description: `Pesanan ${order.orderNumber} belum berisi item dan akan dibatalkan. Meja (bila ada) akan dilepas.`,
                    confirmLabel: 'Ya, Batalkan',
                    tone: 'danger',
                  })
                  if (!ok) return
                  try {
                    await cancelEmptyOrder(order.id, { userId: currentUser.id, userName: currentUser.name })
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Gagal membatalkan pesanan')
                  }
                }}
              />
            ))}
          </div>
        </div>
        {confirmDialog}
    </Modal>
  )
}

function OpenBillRow({ order, onSelect, onCancel }: { order: Order; onSelect: () => void; onCancel: () => void }) {
  const items = useLiveQuery(() => listOrderItems(order.id), [order.id])
  // `undefined` = masih memuat — jangan sempat menampilkan "Kosong"/tombol batal untuk pesanan berisi item.
  const isEmpty = items !== undefined && items.filter((i) => !i.removed && !i.voided).length === 0

  return (
    <div className="card w-full p-4 text-left hover:border-brand-600">
      <button className="block w-full text-left" onClick={onSelect}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-ink-50">{order.orderNumber}</span>
          <span className="text-xs text-ink-400">{durationSince(order.createdAt, Date.now())} lalu</span>
        </div>
        <div className="mt-1 text-sm text-ink-300">
          {ORDER_TYPE_LABELS[order.type]}
          {order.queueNumber ? ` • Antrean #${order.queueNumber}` : ''}
          {order.notes ? ` • ${order.notes}` : ''}
          {isEmpty ? ' • Kosong' : ''}
        </div>
        {order.payLater && (
          <div className="mt-1 text-sm">
            <span className="font-semibold text-accent-500">Bill Gantung • {order.payLater.name}</span>
            {order.payLater.note && <span className="text-ink-400"> — {order.payLater.note}</span>}
            <div className="text-xs text-ink-500">
              Dicatat {formatDateTime(order.payLater.markedAt)} oleh {order.payLater.markedByName}
            </div>
          </div>
        )}
        <div className="mt-2 font-bold text-brand-400">{formatRupiah(order.grandTotal)}</div>
      </button>
      {isEmpty && (
        <button
          className="btn-ghost btn-compact mt-2 w-full !text-red-400"
          onClick={(e) => {
            e.stopPropagation()
            onCancel()
          }}
        >
          Batalkan Pesanan Kosong
        </button>
      )}
    </div>
  )
}
