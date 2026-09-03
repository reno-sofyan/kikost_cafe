import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getOrder, listOrderItems } from '@/db/repositories/orders'
import {
  finalizePayment,
  InsufficientPaymentError,
  InsufficientStockError,
  OrderAlreadyFinalizedError,
  type PaymentInput,
} from '@/db/repositories/checkout'
import { useSessionStore } from '@/state/sessionStore'
import { useSubmitGuard } from '@/lib/useSubmitGuard'
import { formatRupiah } from '@/lib/currency'
import { CashPaymentModal } from '@/features/payments/CashPaymentModal'
import { QrisPaymentModal } from '@/features/payments/QrisPaymentModal'
import { ReferencePaymentModal } from '@/features/payments/ReferencePaymentModal'
import { PaymentSuccessScreen } from '@/features/payments/PaymentSuccessScreen'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import { Icon } from '@/components/ui/Icon'
import type { PaymentMethod, User } from '@/types/domain'

interface PaymentLine extends PaymentInput {
  key: string
  methodLabel: string
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
}

export function OrderPaymentScreen() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!

  const order = useLiveQuery(() => (orderId ? getOrder(orderId) : undefined), [orderId])
  const items = useLiveQuery(() => (orderId ? listOrderItems(orderId) : []), [orderId]) ?? []

  const [lines, setLines] = useState<PaymentLine[]>([])
  const [activeModal, setActiveModal] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [stockOverride, setStockOverride] = useState<{ items: string[] } | null>(null)

  async function runFinalize(allowNegativeStock?: { approverUserId: string; approverName: string }) {
    if (!order) return
    setError(null)
    try {
      await finalizePayment({
        orderId: order.id,
        payments: lines.map(({ method, amount, receivedAmount, reference }) => ({ method, amount, receivedAmount, reference })),
        confirmedByUserId: currentUser.id,
        allowNegativeStock,
      })
      setCompleted(true)
    } catch (e) {
      if (e instanceof OrderAlreadyFinalizedError) {
        setCompleted(true)
        return
      }
      if (e instanceof InsufficientStockError) {
        setStockOverride({ items: e.items })
        return
      }
      if (e instanceof InsufficientPaymentError) {
        setError(e.message)
        return
      }
      setError(e instanceof Error ? e.message : 'Gagal menyelesaikan pembayaran')
    }
  }

  const [isSubmitting, submitPayment] = useSubmitGuard(() => runFinalize())

  if (!order) {
    return <div className="flex h-full items-center justify-center text-ink-400">Memuat pesanan...</div>
  }

  if (completed) {
    return <PaymentSuccessScreen orderId={order.id} />
  }

  const paidSoFar = lines.reduce((sum, l) => sum + l.amount, 0)
  const remaining = Math.max(0, order.grandTotal - paidSoFar)

  function addLine(line: Omit<PaymentLine, 'key' | 'methodLabel'>) {
    setLines((prev) => [...prev, { ...line, key: crypto.randomUUID(), methodLabel: METHOD_LABELS[line.method] }])
    setActiveModal(null)
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  const activeItems = items.filter((i) => !i.voided)

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <button className="btn-ghost mb-4" onClick={() => navigate(-1)}>
          <Icon name="arrowLeft" size={18} className="mr-1" /> Kembali
        </button>
        <h1 className="mb-1 text-xl font-bold text-ink-50">Pembayaran • {order.orderNumber}</h1>
        <p className="mb-6 text-ink-400">{activeItems.length} item</p>

        <div className="card mb-6 p-4">
          {activeItems.map((item) => (
            <div key={item.id} className="flex justify-between border-b border-ink-800 py-2 text-sm last:border-0">
              <span className="text-ink-200">
                {item.qty}x {item.productName}
              </span>
              <span className="text-ink-100">{formatRupiah(item.lineTotal)}</span>
            </div>
          ))}
        </div>

        <div className="card mb-6 space-y-1 p-4 text-sm">
          <Row label="Subtotal" value={order.subtotal} />
          {order.discountAmount > 0 && <Row label="Diskon" value={-order.discountAmount} />}
          {order.serviceChargeAmount > 0 && <Row label="Service Charge" value={order.serviceChargeAmount} />}
          {order.taxAmount > 0 && <Row label="Pajak" value={order.taxAmount} />}
          {order.roundingAdjustment !== 0 && <Row label="Pembulatan" value={order.roundingAdjustment} />}
          <div className="flex justify-between border-t border-ink-700 pt-2 text-lg font-bold text-ink-50">
            <span>Total</span>
            <span>{formatRupiah(order.grandTotal)}</span>
          </div>
        </div>

        <h2 className="mb-2 font-semibold text-ink-100">Metode Pembayaran</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['cash', 'qris', 'transfer', 'card'] as PaymentMethod[]).map((method) => (
            <button
              key={method}
              disabled={remaining <= 0}
              onClick={() => setActiveModal(method)}
              className="btn-secondary"
            >
              {METHOD_LABELS[method]}
            </button>
          ))}
        </div>

        {lines.length > 0 && (
          <div className="mb-4 space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="flex items-center justify-between rounded-xl bg-ink-800 px-4 py-3">
                <span className="text-ink-200">{line.methodLabel}</span>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-ink-50">{formatRupiah(line.amount)}</span>
                  <button className="text-red-400" onClick={() => removeLine(line.key)}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3">
          <span className="text-ink-300">Sisa Tagihan</span>
          <span className={`text-lg font-bold ${remaining > 0 ? 'text-brew-400' : 'text-sage-500'}`}>{formatRupiah(remaining)}</span>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button className="btn-primary w-full" disabled={remaining > 0 || isSubmitting || lines.length === 0} onClick={() => submitPayment()}>
          {isSubmitting ? 'Memproses...' : 'Selesaikan Pembayaran'}
        </button>
      </div>

      {activeModal === 'cash' && (
        <CashPaymentModal
          remaining={remaining}
          onCancel={() => setActiveModal(null)}
          onConfirm={({ amount, receivedAmount }) => addLine({ method: 'cash', amount, receivedAmount })}
        />
      )}
      {activeModal === 'qris' && (
        <QrisPaymentModal amount={remaining} onCancel={() => setActiveModal(null)} onConfirm={() => addLine({ method: 'qris', amount: remaining })} />
      )}
      {(activeModal === 'transfer' || activeModal === 'card') && (
        <ReferencePaymentModal
          method={activeModal}
          remaining={remaining}
          onCancel={() => setActiveModal(null)}
          onConfirm={({ amount, reference }) => addLine({ method: activeModal, amount, reference })}
        />
      )}

      {stockOverride && (
        <SupervisorPinModal
          title="Stok Bahan Tidak Cukup"
          description={`Stok tidak mencukupi untuk: ${stockOverride.items.join(', ')}. Lanjut menyelesaikan pembayaran (stok akan minus) butuh persetujuan supervisor.`}
          onCancel={() => setStockOverride(null)}
          onApproved={(approver: User) => {
            setStockOverride(null)
            void runFinalize({ approverUserId: approver.id, approverName: approver.name })
          }}
        />
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
