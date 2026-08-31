import { useLiveQuery } from 'dexie-react-hooks'
import { listOpenOrders } from '@/db/repositories/orders'
import { formatRupiah } from '@/lib/currency'
import { durationSince } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-full max-w-sm flex-col bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-none items-center justify-between border-b border-ink-800 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-50">Pesanan Terbuka</h2>
          <button className="btn-ghost !min-h-0 !px-3 !py-2" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {openOrders.length === 0 && <p className="text-center text-sm text-ink-500">Tidak ada pesanan terbuka</p>}
          <div className="space-y-2">
            {openOrders.map((order) => (
              <button
                key={order.id}
                onClick={() => onSelect(order.id)}
                className="card block w-full p-4 text-left hover:border-brew-600"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink-50">{order.orderNumber}</span>
                  <span className="text-xs text-ink-400">{durationSince(order.createdAt, Date.now())} lalu</span>
                </div>
                <div className="mt-1 text-sm text-ink-300">
                  {ORDER_TYPE_LABELS[order.type]}
                  {order.queueNumber ? ` • Antrean #${order.queueNumber}` : ''}
                </div>
                <div className="mt-2 font-bold text-brew-400">{formatRupiah(order.grandTotal)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
