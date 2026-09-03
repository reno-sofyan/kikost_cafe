import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listOrderItems } from '@/db/repositories/orders'
import { voidOrder, returnOrderItems } from '@/db/repositories/checkout'
import { roleHasPermission } from '@/lib/permissions'
import { useSessionStore } from '@/state/sessionStore'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah } from '@/lib/currency'
import { prepareReceiptData } from '@/features/printing/printReceipt'
import { PrintPreviewModal } from '@/features/printing/PrintPreviewModal'
import { ReasonPromptModal } from '@/components/ui/ReasonPromptModal'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import { Icon } from '@/components/ui/Icon'
import type { Order, User } from '@/types/domain'
import type { ReceiptData } from '@/features/printing/receiptData'

const STATUS_LABELS: Record<Order['status'], string> = {
  open: 'Terbuka',
  paid: 'Lunas',
  void: 'Dibatalkan',
  completed: 'Selesai',
}

export function OrderDetailPanel({ order, onClose }: { order: Order; onClose: () => void }) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const items = useLiveQuery(() => listOrderItems(order.id), [order.id]) ?? []
  const payments = useLiveQuery(() => db.payments.where('orderId').equals(order.id).toArray(), [order.id]) ?? []
  const returns = useLiveQuery(() => db.returns.where('orderId').equals(order.id).toArray(), [order.id]) ?? []

  const [showPrint, setShowPrint] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [flow, setFlow] = useState<null | 'void-reason' | 'void-pin' | 'return-select' | 'return-reason' | 'return-pin'>(null)
  const [reason, setReason] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [restock, setRestock] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canVoid = roleHasPermission(currentUser.role, 'order.void')
  const canReturn = roleHasPermission(currentUser.role, 'order.return')
  const canRestock = roleHasPermission(currentUser.role, 'refund.restock')
  const activeItems = items.filter((i) => !i.voided && !i.removed)

  async function openPrintPreview() {
    const data = await prepareReceiptData(order, { isReprint: true })
    setReceipt(data)
    setShowPrint(true)
  }

  async function handleVoidApproved(approver: User) {
    try {
      await voidOrder({ orderId: order.id, reason, approverUserId: approver.id, approverName: approver.name })
      setFlow(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membatalkan transaksi')
      setFlow(null)
    }
  }

  async function handleReturnApproved(approver: User) {
    try {
      await returnOrderItems({
        orderId: order.id,
        orderItemIds: selectedItemIds,
        reason,
        restock,
        approverUserId: approver.id,
        approverName: approver.name,
      })
      setFlow(null)
      setSelectedItemIds([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses retur')
      setFlow(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-none items-center justify-between border-b border-ink-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-ink-50">{order.orderNumber}</h2>
            <p className="text-sm text-ink-400">
              {STATUS_LABELS[order.status]} • {formatDateTime(order.createdAt)}
            </p>
          </div>
          <button className="btn-ghost !min-h-0 !px-3 !py-2" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {order.voidReason && (
            <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">Dibatalkan: {order.voidReason}</div>
          )}
          {returns.length > 0 && (
            <div className="mb-3 space-y-1">
              {returns.map((r) => (
                <div key={r.id} className="rounded-lg bg-yellow-900/20 px-3 py-2 text-sm text-yellow-300">
                  Retur {formatRupiah(r.refundAmount)}: {r.reason}
                </div>
              ))}
            </div>
          )}

          <div className="card mb-4 p-4">
            <p className="mb-2 text-sm font-semibold text-ink-300">Kasir: {order.cashierName}</p>
            {items.map((item) => (
              <div key={item.id} className={`flex justify-between border-b border-ink-800 py-2 text-sm last:border-0 ${item.voided ? 'opacity-50 line-through' : ''}`}>
                <span className="text-ink-200">
                  {item.qty}x {item.productName}
                </span>
                <span className="text-ink-100">{formatRupiah(item.lineTotal)}</span>
              </div>
            ))}
          </div>

          <div className="card mb-4 space-y-1 p-4 text-sm">
            <Row label="Subtotal" value={order.subtotal} />
            {order.discountAmount > 0 && <Row label="Diskon" value={-order.discountAmount} />}
            {order.serviceChargeAmount > 0 && <Row label="Service Charge" value={order.serviceChargeAmount} />}
            {order.taxAmount > 0 && <Row label="Pajak" value={order.taxAmount} />}
            <div className="flex justify-between border-t border-ink-700 pt-2 font-bold text-ink-50">
              <span>Total</span>
              <span>{formatRupiah(order.grandTotal)}</span>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="card mb-4 p-4">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className="text-ink-300">{p.method}</span>
                  <span className="text-ink-100">{formatRupiah(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          {flow === 'return-select' && (
            <div className="card mb-4 p-4">
              <p className="mb-2 text-sm font-semibold text-ink-300">Pilih item yang diretur</p>
              {activeItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2 py-1 text-sm text-ink-200">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={(e) =>
                      setSelectedItemIds((prev) => (e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                    }
                  />
                  {item.qty}x {item.productName} • {formatRupiah(item.lineTotal)}
                </label>
              ))}
              {canRestock ? (
                <label className="mt-2 flex items-center gap-2 text-sm text-ink-300">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
                  Kembalikan bahan ke stok (hanya jika belum dibuat)
                </label>
              ) : (
                <p className="mt-2 text-xs text-ink-500">
                  Bahan tidak dikembalikan ke stok. Perlu izin supervisor untuk mengembalikan stok.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => setFlow(null)}>
                  Batal
                </button>
                <button className="btn-primary flex-[2]" disabled={selectedItemIds.length === 0} onClick={() => setFlow('return-reason')}>
                  Lanjut
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-none flex-col gap-2 border-t border-ink-800 p-4">
          <button className="btn-primary" onClick={() => void openPrintPreview()}>
            Reprint Struk
          </button>
          {canReturn && order.status === 'paid' && activeItems.length > 0 && (
            <button className="btn-secondary" onClick={() => setFlow('return-select')}>
              Retur
            </button>
          )}
          {canVoid && order.status !== 'void' && (
            <button className="btn-danger" onClick={() => setFlow('void-reason')}>
              Batalkan Transaksi
            </button>
          )}
        </div>
      </div>

      {showPrint && receipt && <PrintPreviewModal data={receipt} onClose={() => setShowPrint(false)} />}

      {flow === 'void-reason' && (
        <ReasonPromptModal
          title="Batalkan Transaksi"
          description="Pembatalan transaksi memerlukan persetujuan supervisor/administrator."
          confirmLabel="Lanjut"
          onCancel={() => setFlow(null)}
          onConfirm={(r) => {
            setReason(r)
            setFlow('void-pin')
          }}
        />
      )}
      {flow === 'void-pin' && (
        <SupervisorPinModal title="Konfirmasi Pembatalan" onCancel={() => setFlow(null)} onApproved={(u) => void handleVoidApproved(u)} />
      )}
      {flow === 'return-reason' && (
        <ReasonPromptModal
          title="Alasan Retur"
          confirmLabel="Lanjut"
          onCancel={() => setFlow('return-select')}
          onConfirm={(r) => {
            setReason(r)
            setFlow('return-pin')
          }}
        />
      )}
      {flow === 'return-pin' && (
        <SupervisorPinModal title="Konfirmasi Retur" onCancel={() => setFlow('return-select')} onApproved={(u) => void handleReturnApproved(u)} />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-ink-300">
      <span>{label}</span>
      <span>{formatRupiah(value)}</span>
    </div>
  )
}
