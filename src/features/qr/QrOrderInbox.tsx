import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import {
  activeOrderOnTable,
  confirmQrOrder,
  listPendingQrOrders,
  listPendingTableCalls,
  mergeQrOrderIntoTable,
  rejectQrOrder,
  resolveTableCall,
} from '@/db/repositories/qrOrders'
import { playNewOrderChime } from '@/lib/kitchenSound'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { formatRupiah } from '@/lib/currency'
import { durationSince } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import type { OrderItem } from '@/types/domain'

const CALL_LABEL: Record<'waiter' | 'bill', string> = {
  waiter: 'Panggil Waiter',
  bill: 'Minta Tagihan',
}

export function QrOrderInbox() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canConfirm = roleHasPermission(currentUser.role, 'qr.order.confirm')
  const actor = { userId: currentUser.id, userName: currentUser.name }

  const pending = useLiveQuery(() => listPendingQrOrders(), []) ?? []
  const calls = useLiveQuery(() => listPendingTableCalls(), []) ?? []
  const tables = useLiveQuery(() => db.cafeTables.toArray(), []) ?? []
  const tableName = useMemo(() => new Map(tables.map((t) => [t.id, t.name])), [tables])

  const pendingTableIds = useMemo(
    () => Array.from(new Set(pending.map((o) => o.tableId).filter((id): id is string => !!id))),
    [pending],
  )
  const mergeTargets =
    useLiveQuery(async () => {
      const map = new Map<string, { id: string; orderNumber: string }>()
      for (const tid of pendingTableIds) {
        const active = await activeOrderOnTable(tid)
        if (active) map.set(tid, { id: active.id, orderNumber: active.orderNumber })
      }
      return map
    }, [pendingTableIds.join(',')]) ?? new Map<string, { id: string; orderNumber: string }>()

  const [now, setNow] = useState(Date.now())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const seenIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const ids = [...pending.map((o) => o.id), ...calls.map((c) => c.id)]
    const fresh = ids.some((id) => !seenIds.current.has(id))
    if (fresh && seenIds.current.size > 0) playNewOrderChime()
    seenIds.current = new Set(ids)
  }, [pending, calls])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      setRejecting(null)
      setRejectReason('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses')
    } finally {
      setBusyId(null)
    }
  }

  async function accept(orderId: string) {
    setBusyId(orderId)
    setError(null)
    setNotice(null)
    try {
      const res = await confirmQrOrder(orderId, actor)
      const parts: string[] = [`Diterima — antrean #${res.queueNumber}.`]
      if (res.priceChanged) {
        parts.push(`Total disesuaikan Rp${res.oldTotal.toLocaleString('id-ID')} → Rp${res.newTotal.toLocaleString('id-ID')} (harga menu berubah).`)
      }
      if (res.removedItems.length) parts.push(`Dikeluarkan (tak tersedia): ${res.removedItems.join(', ')}.`)
      setNotice(parts.join(' '))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-ink-800 px-6 py-4">
        <h1 className="text-xl font-bold text-ink-50">Pesanan QR</h1>
        {pending.length > 0 && (
          <span className="rounded-full bg-brew-600 px-2 py-0.5 text-sm font-semibold text-white">{pending.length}</span>
        )}
        {!canConfirm && <span className="text-sm text-ink-400">Anda tidak berwenang menerima/menolak pesanan.</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>}
        {notice && (
          <p className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-sage-600/15 px-3 py-2 text-sm text-sage-300">
            <span>{notice}</span>
            <button className="flex-none text-ink-400" onClick={() => setNotice(null)}>
              tutup
            </button>
          </p>
        )}

        {calls.length > 0 && (
          <div className="mb-4 space-y-2">
            {calls.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-brown-600/40 bg-brown-600/10 px-4 py-3">
                <span className="text-sm font-medium text-brown-300">
                  <Icon name="bell" size={15} className="mr-1.5 inline" />
                  {tableName.get(c.tableId) ?? 'Meja'} — {CALL_LABEL[c.type]}
                  <span className="ml-2 text-xs text-ink-400">{durationSince(c.createdAt, now)}</span>
                </span>
                <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => void run(c.id, () => resolveTableCall(c.id))}>
                  Selesai
                </button>
              </div>
            ))}
          </div>
        )}

        {pending.length === 0 && calls.length === 0 && (
          <p className="mt-16 text-center text-ink-500">Belum ada pesanan QR yang menunggu.</p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pending.map((order) => (
            <QrOrderCard
              key={order.id}
              orderId={order.id}
              header={
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink-50">{order.tableId ? tableName.get(order.tableId) ?? 'Meja' : 'Tanpa meja'}</span>
                    <span className="text-xs text-ink-400">{durationSince(order.createdAt, now)}</span>
                  </div>
                  <div className="text-sm text-ink-300">
                    {order.orderNumber}
                    {order.notes ? <span className="ml-2 font-medium text-ink-100">• {order.notes}</span> : null}
                  </div>
                </>
              }
              footer={
                <div className="text-right text-sm font-semibold text-ink-100">
                  Total sementara {formatRupiah(order.grandTotal)}
                </div>
              }
              actions={
                canConfirm ? (
                  rejecting === order.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        className="input-field !min-h-0 !py-2 text-sm"
                        placeholder="Alasan penolakan (wajib)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-danger flex-1 !min-h-0 !py-2 text-sm"
                          disabled={busyId === order.id || !rejectReason.trim()}
                          onClick={() => void run(order.id, () => rejectQrOrder(order.id, rejectReason, actor))}
                        >
                          Tolak Pesanan
                        </button>
                        <button
                          className="btn-ghost !min-h-0 !py-2 text-sm"
                          onClick={() => {
                            setRejecting(null)
                            setRejectReason('')
                          }}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {order.tableId && mergeTargets.get(order.tableId) && (
                        <button
                          className="btn-secondary w-full !min-h-0 !py-2 text-sm"
                          disabled={busyId === order.id}
                          onClick={() =>
                            void run(order.id, () =>
                              mergeQrOrderIntoTable(order.id, mergeTargets.get(order.tableId!)!.id, actor),
                            )
                          }
                        >
                          Gabung ke {mergeTargets.get(order.tableId)!.orderNumber} (pesanan meja aktif)
                        </button>
                      )}
                      <div className="flex gap-2">
                        <button
                          className="btn-primary flex-1 !min-h-0 !py-2 text-sm"
                          disabled={busyId === order.id}
                          onClick={() => void accept(order.id)}
                        >
                          {busyId === order.id ? 'Memproses...' : 'Terima sbg. pesanan baru'}
                        </button>
                        <button
                          className="btn-secondary !min-h-0 !px-3 !py-2 text-sm"
                          onClick={() => setRejecting(order.id)}
                        >
                          Tolak
                        </button>
                      </div>
                    </div>
                  )
                ) : null
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function QrOrderCard(props: {
  orderId: string
  header: ReactNode
  footer: ReactNode
  actions: ReactNode
}) {
  const items = useLiveQuery<OrderItem[]>(
    () => db.orderItems.where('orderId').equals(props.orderId).filter((i) => !i.removed && !i.voided).toArray(),
    [props.orderId],
  ) ?? []

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div>{props.header}</div>
      <div className="flex-1 space-y-1.5 border-y border-ink-800 py-2">
        {items.map((it) => (
          <div key={it.id} className="text-sm">
            <span className="font-semibold text-ink-50">{it.qty}× {it.productName}</span>
            {it.modifiers.map((m) => (
              <span key={m.optionId} className="ml-2 text-xs text-ink-400">
                {m.optionName}
              </span>
            ))}
            {it.notes && <div className="text-xs italic text-ink-400">"{it.notes}"</div>}
          </div>
        ))}
      </div>
      {props.footer}
      {props.actions}
    </div>
  )
}
