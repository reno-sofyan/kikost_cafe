import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { getOrder, listOrderItems } from '@/db/repositories/orders'
import { getSettings } from '@/db/repositories/settings'
import { listOrderBills, unsplitBills } from '@/db/repositories/billing'
import {
  finalizePayment,
  InsufficientStockError,
  OrderAlreadyFinalizedError,
  payOrderBill,
  type PaymentInput,
} from '@/db/repositories/checkout'
import { useSessionStore } from '@/state/sessionStore'
import { useSubmitGuard } from '@/lib/useSubmitGuard'
import { formatRupiah } from '@/lib/currency'
import { CashPaymentModal } from '@/features/payments/CashPaymentModal'
import { QrisPaymentModal } from '@/features/payments/QrisPaymentModal'
import { ReferencePaymentModal } from '@/features/payments/ReferencePaymentModal'
import { PaymentSuccessScreen } from '@/features/payments/PaymentSuccessScreen'
import { SplitBillModal } from '@/features/payments/SplitBillModal'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import { Icon } from '@/components/ui/Icon'
import type { Bill, Order, OrderItem, PaymentMethod, User } from '@/types/domain'

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
  const allowPartial = useLiveQuery(async () => (await getSettings()).allowPartialPayment, []) ?? false
  const bills = useLiveQuery(() => (orderId ? listOrderBills(orderId) : []), [orderId]) ?? []

  const [completed, setCompleted] = useState(false)
  const [showSplit, setShowSplit] = useState(false)

  if (!order || !orderId) {
    return <div className="flex h-full items-center justify-center text-ink-400">Memuat pesanan...</div>
  }
  if (completed || order.lifecycleStatus === 'COMPLETED') {
    return <PaymentSuccessScreen orderId={order.id} />
  }

  const activeItems = items.filter((i) => !i.voided && !i.removed)
  const portionBills = bills.filter((b) => b.grandTotal > 0 && b.itemIds !== 'all')
  const isSplit = portionBills.length > 0
  const splitBills = isSplit ? bills.filter((b) => b.grandTotal > 0) : []
  const itemById = new Map(activeItems.map((i) => [i.id, i]))

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <button className="btn-ghost mb-4" onClick={() => navigate(-1)}>
          <Icon name="arrowLeft" size={18} className="mr-1" /> Kembali
        </button>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink-50">Pembayaran • {order.orderNumber}</h1>
            <p className="text-ink-400">{activeItems.length} item · Total {formatRupiah(order.grandTotal)}</p>
          </div>
          {!isSplit && activeItems.length > 1 && (
            <button className="btn-secondary !min-h-0 !px-3 !py-2 text-sm" onClick={() => setShowSplit(true)}>
              <Icon name="receipt" size={15} className="mr-1 inline" /> Pisah per Item
            </button>
          )}
          {isSplit && (
            <button
              className="btn-ghost !min-h-0 !px-3 !py-2 text-sm"
              onClick={() => void unsplitBills(orderId).catch(() => {})}
            >
              Gabungkan Tagihan
            </button>
          )}
        </div>

        {isSplit ? (
          <div className="space-y-5">
            {splitBills.map((bill) => (
              <BillPayCard
                key={bill.id}
                bill={bill}
                items={(bill.itemIds === 'all' ? activeItems : bill.itemIds.map((id) => itemById.get(id)).filter(Boolean) as OrderItem[])}
                allowPartial={allowPartial}
                userId={currentUser.id}
                onCompleted={() => setCompleted(true)}
              />
            ))}
          </div>
        ) : (
          <SingleBillPayment
            order={order}
            items={activeItems}
            allowPartial={allowPartial}
            userId={currentUser.id}
            onPartial={() => navigate('/kasir')}
            onCompleted={() => setCompleted(true)}
          />
        )}
      </div>

      {showSplit && (
        <SplitBillModal orderId={orderId} items={activeItems} onClose={() => setShowSplit(false)} onDone={() => setShowSplit(false)} />
      )}
    </div>
  )
}

// ---- Pembayaran tanpa pemecahan (alur lama) ----

function SingleBillPayment({
  order,
  items,
  allowPartial,
  userId,
  onPartial,
  onCompleted,
}: {
  order: Order
  items: OrderItem[]
  allowPartial: boolean
  userId: string
  onPartial: () => void
  onCompleted: () => void
}) {
  const priorPaid =
    useLiveQuery(
      async () =>
        (await db.payments.where('orderId').equals(order.id).toArray())
          .filter((p) => p.amount > 0)
          .reduce((s, p) => s + p.amount, 0),
      [order.id],
    ) ?? 0

  const [lines, setLines] = useState<PaymentLine[]>([])
  const [activeModal, setActiveModal] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stockOverride, setStockOverride] = useState<{ items: string[] } | null>(null)

  async function runFinalize(allowNegativeStock?: { approverUserId: string; approverName: string }) {
    setError(null)
    try {
      const res = await finalizePayment({
        orderId: order.id,
        payments: lines.map(({ method, amount, receivedAmount, reference }) => ({ method, amount, receivedAmount, reference })),
        confirmedByUserId: userId,
        allowPartial,
        allowNegativeStock,
      })
      if (res.order.lifecycleStatus === 'COMPLETED') onCompleted()
      else onPartial()
    } catch (e) {
      if (e instanceof OrderAlreadyFinalizedError) return onCompleted()
      if (e instanceof InsufficientStockError) return setStockOverride({ items: e.items })
      setError(e instanceof Error ? e.message : 'Gagal menyelesaikan pembayaran')
    }
  }

  const [isSubmitting, submitPayment] = useSubmitGuard(() => runFinalize())

  const linesTotal = lines.reduce((sum, l) => sum + l.amount, 0)
  const remaining = Math.max(0, order.grandTotal - priorPaid - linesTotal)
  const canSettle = lines.length > 0 && (remaining <= 0 || allowPartial)

  return (
    <>
      <div className="card mb-6 p-4">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between border-b border-ink-800 py-2 text-sm last:border-0">
            <span className="text-ink-200">{item.qty}x {item.productName}</span>
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

      <PayControls
        remaining={remaining}
        lines={lines}
        activeModal={activeModal}
        setActiveModal={setActiveModal}
        addLine={(l) => setLines((p) => [...p, { ...l, key: crypto.randomUUID(), methodLabel: METHOD_LABELS[l.method] }])}
        removeLine={(k) => setLines((p) => p.filter((l) => l.key !== k))}
      />

      {priorPaid > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3 text-sm">
          <span className="text-ink-400">Sudah dibayar sebelumnya</span>
          <span className="font-semibold text-sage-500">{formatRupiah(priorPaid)}</span>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3">
        <span className="text-ink-300">Sisa Tagihan</span>
        <span className={`text-lg font-bold ${remaining > 0 ? 'text-brew-400' : 'text-sage-500'}`}>{formatRupiah(remaining)}</span>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <button className="btn-primary w-full" disabled={!canSettle || isSubmitting} onClick={() => submitPayment()}>
        {isSubmitting ? 'Memproses...' : allowPartial && remaining > 0 ? `Bayar Sebagian • ${formatRupiah(linesTotal)}` : 'Selesaikan Pembayaran'}
      </button>

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
    </>
  )
}

// ---- Kartu pembayaran satu bill (mode dipecah) ----

function BillPayCard({
  bill,
  items,
  allowPartial,
  userId,
  onCompleted,
}: {
  bill: Bill
  items: OrderItem[]
  allowPartial: boolean
  userId: string
  onCompleted: () => void
}) {
  const [lines, setLines] = useState<PaymentLine[]>([])
  const [activeModal, setActiveModal] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stockOverride, setStockOverride] = useState<{ items: string[] } | null>(null)

  const paid = bill.paymentStatus === 'PAID'
  const remaining = Math.max(0, bill.grandTotal - bill.amountPaid - lines.reduce((s, l) => s + l.amount, 0))
  const canSettle = lines.length > 0 && (remaining <= 0 || allowPartial)

  async function run(allowNegativeStock?: { approverUserId: string; approverName: string }) {
    setError(null)
    try {
      const res = await payOrderBill({
        billId: bill.id,
        payments: lines.map(({ method, amount, receivedAmount, reference }) => ({ method, amount, receivedAmount, reference })),
        confirmedByUserId: userId,
        allowPartial,
        allowNegativeStock,
      })
      setLines([])
      if (res.order.lifecycleStatus === 'COMPLETED') onCompleted()
    } catch (e) {
      if (e instanceof OrderAlreadyFinalizedError) return
      if (e instanceof InsufficientStockError) return setStockOverride({ items: e.items })
      setError(e instanceof Error ? e.message : 'Gagal membayar tagihan')
    }
  }
  const [isSubmitting, submit] = useSubmitGuard(() => run())

  return (
    <div className={`card p-4 ${paid ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-ink-50">{bill.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${paid ? 'bg-sage-600/20 text-sage-400' : 'bg-brew-600/20 text-brew-300'}`}>
          {paid ? 'Lunas' : bill.paymentStatus === 'PARTIALLY_PAID' ? `Kurang ${formatRupiah(bill.grandTotal - bill.amountPaid)}` : formatRupiah(bill.grandTotal)}
        </span>
      </div>
      <div className="mb-3 space-y-1 border-y border-ink-800 py-2 text-sm">
        {items.map((it) => (
          <div key={it.id} className="flex justify-between text-ink-300">
            <span>{it.qty}× {it.productName}</span>
            <span>{formatRupiah(it.lineTotal)}</span>
          </div>
        ))}
        <div className="flex justify-between pt-1 font-semibold text-ink-100">
          <span>Total (incl. pajak & SC)</span>
          <span>{formatRupiah(bill.grandTotal)}</span>
        </div>
      </div>

      {!paid && (
        <>
          <PayControls
            remaining={remaining}
            lines={lines}
            activeModal={activeModal}
            setActiveModal={setActiveModal}
            addLine={(l) => setLines((p) => [...p, { ...l, key: crypto.randomUUID(), methodLabel: METHOD_LABELS[l.method] }])}
            removeLine={(k) => setLines((p) => p.filter((l) => l.key !== k))}
          />
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full !min-h-0 !py-2.5 text-sm" disabled={!canSettle || isSubmitting} onClick={() => submit()}>
            {isSubmitting ? 'Memproses…' : `Bayar ${bill.label}`}
          </button>
        </>
      )}

      {stockOverride && (
        <SupervisorPinModal
          title="Stok Bahan Tidak Cukup"
          description={`Stok tidak mencukupi untuk: ${stockOverride.items.join(', ')}. Lanjut (stok minus) butuh persetujuan supervisor.`}
          onCancel={() => setStockOverride(null)}
          onApproved={(approver: User) => {
            setStockOverride(null)
            void run({ approverUserId: approver.id, approverName: approver.name })
          }}
        />
      )}
    </div>
  )
}

// ---- Kontrol metode pembayaran (dipakai kedua mode) ----

function PayControls({
  remaining,
  lines,
  activeModal,
  setActiveModal,
  addLine,
  removeLine,
}: {
  remaining: number
  lines: PaymentLine[]
  activeModal: PaymentMethod | null
  setActiveModal: (m: PaymentMethod | null) => void
  addLine: (l: Omit<PaymentLine, 'key' | 'methodLabel'>) => void
  removeLine: (key: string) => void
}) {
  return (
    <>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {(['cash', 'qris', 'transfer', 'card'] as PaymentMethod[]).map((method) => (
          <button key={method} disabled={remaining <= 0} onClick={() => setActiveModal(method)} className="btn-secondary !min-h-0 !py-2 text-sm">
            {METHOD_LABELS[method]}
          </button>
        ))}
      </div>

      {lines.length > 0 && (
        <div className="mb-3 space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center justify-between rounded-xl bg-ink-800 px-4 py-2.5">
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

      {activeModal === 'cash' && (
        <CashPaymentModal
          remaining={remaining}
          onCancel={() => setActiveModal(null)}
          onConfirm={({ amount, receivedAmount }) => {
            addLine({ method: 'cash', amount, receivedAmount })
            setActiveModal(null)
          }}
        />
      )}
      {activeModal === 'qris' && (
        <QrisPaymentModal
          amount={remaining}
          onCancel={() => setActiveModal(null)}
          onConfirm={() => {
            addLine({ method: 'qris', amount: remaining })
            setActiveModal(null)
          }}
        />
      )}
      {(activeModal === 'transfer' || activeModal === 'card') && (
        <ReferencePaymentModal
          method={activeModal}
          remaining={remaining}
          onCancel={() => setActiveModal(null)}
          onConfirm={({ amount, reference }) => {
            addLine({ method: activeModal, amount, reference })
            setActiveModal(null)
          }}
        />
      )}
    </>
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
