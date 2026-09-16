import { useLiveQuery } from 'dexie-react-hooks'
import { cancelEmptyOrder, listOpenOrders, listOrderItems } from '@/db/repositories/orders'
import { useSessionStore } from '@/state/sessionStore'
import { formatRupiah } from '@/lib/currency'
import { durationSince } from '@/lib/datetime'
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
  onSelect: (orderId: string) => void
  onClose: () => void
}

export function OpenBillsDrawer({ onSelect, onClose }: Props) {
  const openOrders = useLiveQuery(() => listOpenOrders(), []) ?? []
  const currentUser = useSessionStore((s) => s.currentUser)!
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  return (
    <Modal onClose={onClose} align="end" className="flex h-full w-full max-w-sm flex-col bg-ink-900">
        <div className="flex flex-none items-center justify-between border-b border-ink-800 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-50">Pesanan Terbuka</h2>
          <button className="btn-ghost btn-compact !px-3" aria-label="Tutup" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {openOrders.length === 0 && <p className="text-center text-sm text-ink-500">Tidak ada pesanan terbuka</p>}
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
  const items = useLiveQuery(() => listOrderItems(order.id), [order.id]) ?? []
  const isEmpty = items.filter((i) => !i.removed && !i.voided).length === 0

  return (
    <div className="card w-full p-4 text-left hover:border-brew-600">
      <button className="block w-full text-left" onClick={onSelect}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-ink-50">{order.orderNumber}</span>
          <span className="text-xs text-ink-400">{durationSince(order.createdAt, Date.now())} lalu</span>
        </div>
        <div className="mt-1 text-sm text-ink-300">
          {ORDER_TYPE_LABELS[order.type]}
          {order.queueNumber ? ` • Antrean #${order.queueNumber}` : ''}
          {isEmpty ? ' • Kosong' : ''}
        </div>
        <div className="mt-2 font-bold text-brew-400">{formatRupiah(order.grandTotal)}</div>
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
