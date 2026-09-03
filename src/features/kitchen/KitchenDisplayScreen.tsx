import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listActiveKitchenItems, setOrderItemKitchenStatus } from '@/db/repositories/orders'
import { playNewOrderChime } from '@/lib/kitchenSound'
import { reprintKitchenTicket } from '@/db/repositories/kitchenDispatch'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { durationSince } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import type { KitchenItemStatus, Order, OrderItem } from '@/types/domain'

const ORDER_TYPE_LABELS: Record<Order['type'], string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

const STATUS_TABS: { value: KitchenItemStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'new', label: 'Baru' },
  { value: 'in_progress', label: 'Diproses' },
  { value: 'ready', label: 'Siap' },
]

const NEXT_STATUS: Record<KitchenItemStatus, KitchenItemStatus | null> = {
  new: 'in_progress',
  in_progress: 'ready',
  ready: 'done',
  done: null,
}

const STATUS_ACTION_LABEL: Record<KitchenItemStatus, string> = {
  new: 'Mulai Proses',
  in_progress: 'Tandai Siap',
  ready: 'Selesai',
  done: '',
}

export function KitchenDisplayScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canReprint = roleHasPermission(currentUser.role, 'receipt.reprint')
  const [filter, setFilter] = useState<KitchenItemStatus | 'all'>('all')
  const [now, setNow] = useState(Date.now())
  const items = useLiveQuery(() => listActiveKitchenItems(), [])
  const orderIds = useMemo(() => Array.from(new Set((items ?? []).map((i) => i.orderId))), [items])
  const orders = useLiveQuery(() => db.orders.where('id').anyOf(orderIds.length ? orderIds : ['-']).toArray(), [orderIds])
  const tables = useLiveQuery(() => db.cafeTables.toArray(), []) ?? []
  const ticketsRaw = useLiveQuery(
    () => db.kitchenTickets.where('orderId').anyOf(orderIds.length ? orderIds : ['-']).toArray(),
    [orderIds],
  )
  const tickets = useMemo(() => ticketsRaw ?? [], [ticketsRaw])
  const ticketSeqById = useMemo(() => new Map(tickets.map((t) => [t.id, t.sequenceNo])), [tickets])

  const seenNewIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const currentNewIds = (items ?? []).filter((i) => i.kitchenStatus === 'new' && !i.voided).map((i) => i.id)
    const hasFreshItem = currentNewIds.some((id) => !seenNewIds.current.has(id))
    if (hasFreshItem && seenNewIds.current.size > 0) playNewOrderChime()
    seenNewIds.current = new Set(currentNewIds)
  }, [items])

  const groups = useMemo(() => {
    const byOrder = new Map<string, OrderItem[]>()
    for (const item of items ?? []) {
      if (filter !== 'all' && item.kitchenStatus !== filter) continue
      const list = byOrder.get(item.orderId) ?? []
      list.push(item)
      byOrder.set(item.orderId, list)
    }
    return Array.from(byOrder.entries())
      .map(([orderId, orderItems]) => ({
        order: (orders ?? []).find((o) => o.id === orderId),
        items: orderItems.sort((a, b) => a.createdAt - b.createdAt),
      }))
      .filter((g) => g.order && g.order.status !== 'void')
      .sort((a, b) => (a.items[0]?.createdAt ?? 0) - (b.items[0]?.createdAt ?? 0))
  }, [items, orders, filter])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-ink-800 px-6 py-4">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Dapur</h1>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`btn !min-h-0 !px-4 !py-2 text-sm ${filter === tab.value ? 'btn-primary' : 'btn-secondary'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {groups.length === 0 && <p className="mt-10 text-center text-ink-500">Tidak ada pesanan</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map(({ order, items: orderItems }) => {
            if (!order) return null
            const table = order.tableId ? tables.find((t) => t.id === order.tableId) : undefined
            const oldestCreatedAt = Math.min(...orderItems.map((i) => i.createdAt))
            return (
              <div key={order.id} className="card flex flex-col p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold text-ink-50">{order.orderNumber}</span>
                  <span className="text-xs text-ink-400">{durationSince(oldestCreatedAt, now)}</span>
                </div>
                <div className="mb-3 text-sm text-ink-400">
                  {ORDER_TYPE_LABELS[order.type]}
                  {table ? ` • ${table.name}` : ''}
                  {order.queueNumber ? ` • Antrean #${order.queueNumber}` : ''}
                  {order.notes ? <span className="ml-1 font-medium text-ink-200">• {order.notes}</span> : null}
                </div>

                <div className="flex-1 space-y-2">
                  {orderItems.map((item) => {
                    const seq = item.ticketId ? ticketSeqById.get(item.ticketId) ?? 1 : 1
                    return (
                    <div key={item.id} className={`rounded-lg bg-ink-800 p-2 ${item.voided ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold text-ink-50 ${item.voided ? 'line-through' : ''}`}>
                          {item.qty}x {item.productName}
                        </span>
                        {seq > 1 && (
                          <span className="flex-none rounded bg-brown-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-brown-400">
                            TAMBAHAN #{seq}
                          </span>
                        )}
                      </div>
                      {item.modifiers.map((m) => (
                        <p key={m.optionId} className="text-xs text-ink-400">
                          {m.groupName}: {m.optionName}
                        </p>
                      ))}
                      {item.notes && <p className="text-xs italic text-ink-400">"{item.notes}"</p>}
                      {item.voided ? (
                        <p className="mt-1 text-xs font-semibold text-red-400">DIBATALKAN{item.voidReason ? `: ${item.voidReason}` : ''}</p>
                      ) : (
                        NEXT_STATUS[item.kitchenStatus] && (
                          <button
                            className="btn-secondary mt-2 w-full !min-h-0 !py-1.5 text-xs"
                            onClick={() => void setOrderItemKitchenStatus(item.id, NEXT_STATUS[item.kitchenStatus]!)}
                          >
                            {STATUS_ACTION_LABEL[item.kitchenStatus]}
                          </button>
                        )
                      )}
                    </div>
                    )
                  })}
                </div>

                {canReprint && tickets.filter((t) => t.orderId === order.id).length > 0 && (
                  <button
                    className="btn-ghost mt-3 text-sm"
                    onClick={async () => {
                      for (const t of tickets.filter((tt) => tt.orderId === order.id)) {
                        await reprintKitchenTicket(t.id, { userId: currentUser.id, userName: currentUser.name })
                      }
                    }}
                  >
                    <Icon name="printer" size={16} className="mr-1" /> Cetak Ulang Tiket
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
