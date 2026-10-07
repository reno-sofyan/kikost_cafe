import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { getOrder, listOrderItems } from '@/db/repositories/orders'
import { markAwaitingPayment } from '@/db/repositories/tables'
import { getSettings } from '@/db/repositories/settings'
import { implicitBillId, listOrderBills, unsplitBills } from '@/db/repositories/billing'
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
import { randomUUID } from '@/lib/id'
import { CashPaymentModal } from '@/features/payments/CashPaymentModal'
import { QrisPaymentModal } from '@/features/payments/QrisPaymentModal'
import { MidtransQrisModal } from '@/features/payments/MidtransQrisModal'
import { ReferencePaymentModal } from '@/features/payments/ReferencePaymentModal'
import { PaymentSuccessScreen } from '@/features/payments/PaymentSuccessScreen'
import { SplitBillModal } from '@/features/payments/SplitBillModal'
import { PaymentProofCapture } from '@/features/payments/PaymentProofCapture'
import { EMPTY_PROOF, isProofComplete, type PaymentProofDraft } from '@/features/payments/paymentProofDraft'
import { warmUpStationPrinters } from '@/db/repositories/printQueue'
import { featuresForBusinessType, requiresPaymentProof } from '@/lib/businessType'
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

const DEFAULT_METHODS: PaymentMethod[] = ['cash', 'qris', 'transfer', 'card']
const NO_METHODS: PaymentMethod[] = []

export function OrderPaymentScreen() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!

  const order = useLiveQuery(() => (orderId ? getOrder(orderId) : undefined), [orderId])
  const items = useLiveQuery(() => (orderId ? listOrderItems(orderId) : []), [orderId]) ?? []
  const allowPartial = useLiveQuery(async () => (await getSettings()).allowPartialPayment, []) ?? false
  const features = useLiveQuery(async () => featuresForBusinessType((await getSettings()).businessType), [])
  const paymentMethods = features?.paymentMethods ?? DEFAULT_METHODS
  const proofMethods = features?.paymentProofMethods ?? NO_METHODS
  const midtransEnabled = useLiveQuery(async () => (await getSettings()).qrisProvider === 'midtrans', []) ?? false
  const bills = useLiveQuery(() => (orderId ? listOrderBills(orderId) : []), [orderId]) ?? []

  const [completed, setCompleted] = useState(false)
  const [showSplit, setShowSplit] = useState(false)

  // Meja dine-in ditandai "menunggu pembayaran" begitu kasir membuka layar bayar.
  const tableId = order?.type === 'dine_in' ? order.tableId : null
  const orderDone = order?.lifecycleStatus === 'COMPLETED'
  useEffect(() => {
    if (tableId && !orderDone) void markAwaitingPayment(tableId)
  }, [tableId, orderDone])
  // Sambungkan printer kasir sekarang, supaya struk langsung keluar begitu lunas.
  useEffect(() => {
    void warmUpStationPrinters(['cashier']).catch(() => {})
  }, [])

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
            <button className="btn-secondary !min-h-[2.75rem] !px-3 !py-2 text-sm" onClick={() => setShowSplit(true)}>
              <Icon name="receipt" size={15} className="mr-1 inline" /> Pisah per Item
            </button>
          )}
          {isSplit && (
            <button
              className="btn-ghost !min-h-[2.75rem] !px-3 !py-2 text-sm"
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
                paymentMethods={paymentMethods}
                proofMethods={proofMethods}
                midtransEnabled={midtransEnabled}
                user={currentUser}
                onCompleted={() => setCompleted(true)}
              />
            ))}
          </div>
        ) : (
          <SingleBillPayment
            order={order}
            items={activeItems}
            allowPartial={allowPartial}
            paymentMethods={paymentMethods}
            proofMethods={proofMethods}
            midtransEnabled={midtransEnabled}
            user={currentUser}
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
  paymentMethods,
  proofMethods,
  midtransEnabled,
  user,
  onPartial,
  onCompleted,
}: {
  order: Order
  items: OrderItem[]
  allowPartial: boolean
  paymentMethods: PaymentMethod[]
  proofMethods: PaymentMethod[]
  midtransEnabled: boolean
  user: User
  onPartial: () => void
  onCompleted: () => void
}) {
  const userId = user.id
  const [proof, setProof] = useState<PaymentProofDraft>(EMPTY_PROOF)
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
        payments: lines.map(({ method, amount, receivedAmount, reference, gateway }) => ({ method, amount, receivedAmount, reference, gateway })),
        confirmedByUserId: userId,
        allowPartial,
        allowNegativeStock,
        proof: isProofComplete(proof) ? { photoDataUrls: proof.photos, takenByUserId: user.id, takenByName: user.name } : undefined,
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
  const requireProof = requiresPaymentProof({ paymentProofMethods: proofMethods }, lines.filter((l) => !l.gateway).map((l) => l.method))
  const canSettle = lines.length > 0 && (remaining <= 0 || allowPartial) && (!requireProof || isProofComplete(proof))
  useAutoSettleAfterGateway(lines, remaining <= 0 && canSettle && !isSubmitting, submitPayment)

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
        methods={paymentMethods}
        midtrans={midtransEnabled ? { orderId: order.id, billId: implicitBillId(order.id) } : null}
        addLine={(l) => setLines((p) => [...p, { ...l, key: randomUUID(), methodLabel: METHOD_LABELS[l.method] }])}
        removeLine={(k) => setLines((p) => p.filter((l) => l.key !== k))}
      />

      {priorPaid > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3 text-sm">
          <span className="text-ink-400">Sudah dibayar sebelumnya</span>
          <span className="font-semibold text-success-500">{formatRupiah(priorPaid)}</span>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3">
        <span className="text-ink-300">Sisa Tagihan</span>
        <span className={`text-lg font-bold ${remaining > 0 ? 'text-brand-400' : 'text-success-500'}`}>{formatRupiah(remaining)}</span>
      </div>

      {(proofMethods.length > 0 || isProofComplete(proof)) && lines.length > 0 && (
        <PaymentProofCapture draft={proof} onChange={setProof} required={requireProof} />
      )}

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
  paymentMethods,
  proofMethods,
  midtransEnabled,
  user,
  onCompleted,
}: {
  bill: Bill
  items: OrderItem[]
  allowPartial: boolean
  paymentMethods: PaymentMethod[]
  proofMethods: PaymentMethod[]
  midtransEnabled: boolean
  user: User
  onCompleted: () => void
}) {
  const userId = user.id
  const [proof, setProof] = useState<PaymentProofDraft>(EMPTY_PROOF)
  const [lines, setLines] = useState<PaymentLine[]>([])
  const [activeModal, setActiveModal] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stockOverride, setStockOverride] = useState<{ items: string[] } | null>(null)

  const paid = bill.paymentStatus === 'PAID'
  const remaining = Math.max(0, bill.grandTotal - bill.amountPaid - lines.reduce((s, l) => s + l.amount, 0))
  const requireProof = requiresPaymentProof({ paymentProofMethods: proofMethods }, lines.filter((l) => !l.gateway).map((l) => l.method))
  const canSettle = lines.length > 0 && (remaining <= 0 || allowPartial) && (!requireProof || isProofComplete(proof))

  async function run(allowNegativeStock?: { approverUserId: string; approverName: string }) {
    setError(null)
    try {
      const res = await payOrderBill({
        billId: bill.id,
        payments: lines.map(({ method, amount, receivedAmount, reference, gateway }) => ({ method, amount, receivedAmount, reference, gateway })),
        confirmedByUserId: userId,
        allowPartial,
        allowNegativeStock,
        proof: isProofComplete(proof) ? { photoDataUrls: proof.photos, takenByUserId: user.id, takenByName: user.name } : undefined,
      })
      setLines([])
      setProof(EMPTY_PROOF)
      if (res.order.lifecycleStatus === 'COMPLETED') onCompleted()
    } catch (e) {
      if (e instanceof OrderAlreadyFinalizedError) return
      if (e instanceof InsufficientStockError) return setStockOverride({ items: e.items })
      setError(e instanceof Error ? e.message : 'Gagal membayar tagihan')
    }
  }
  const [isSubmitting, submit] = useSubmitGuard(() => run())
  useAutoSettleAfterGateway(lines, !paid && remaining <= 0 && canSettle && !isSubmitting, submit)

  return (
    <div className={`card p-4 ${paid ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-ink-50">{bill.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${paid ? 'bg-success-600/15 text-success-500' : 'bg-brand-600/15 text-brand-700'}`}>
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
            methods={paymentMethods}
            midtrans={midtransEnabled ? { orderId: bill.orderId, billId: bill.id } : null}
            addLine={(l) => setLines((p) => [...p, { ...l, key: randomUUID(), methodLabel: METHOD_LABELS[l.method] }])}
            removeLine={(k) => setLines((p) => p.filter((l) => l.key !== k))}
          />
          {(proofMethods.length > 0 || isProofComplete(proof)) && lines.length > 0 && (
            <PaymentProofCapture draft={proof} onChange={setProof} required={requireProof} />
          )}
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full !min-h-[2.75rem] !py-2.5 text-sm" disabled={!canSettle || isSubmitting} onClick={() => submit()}>
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

/**
 * Pembayaran yang dikonfirmasi gateway (Midtrans) sudah benar-benar diterima —
 * selesaikan transaksi otomatis begitu nominalnya menutup tagihan, supaya kasir
 * tak perlu menekan apa pun (dan pesanan tak tertinggal setengah jalan).
 */
function useAutoSettleAfterGateway(lines: PaymentLine[], ready: boolean, settle: () => void) {
  const settledFor = useRef<string | null>(null)
  const lastGateway = [...lines].reverse().find((l) => l.gateway)
  useEffect(() => {
    if (!lastGateway || !ready || settledFor.current === lastGateway.key) return
    settledFor.current = lastGateway.key
    settle()
  }, [lastGateway, ready, settle])
}

function PayControls({
  methods,
  remaining,
  lines,
  activeModal,
  setActiveModal,
  addLine,
  removeLine,
  midtrans,
}: {
  methods: PaymentMethod[]
  remaining: number
  lines: PaymentLine[]
  activeModal: PaymentMethod | null
  setActiveModal: (m: PaymentMethod | null) => void
  addLine: (l: Omit<PaymentLine, 'key' | 'methodLabel'>) => void
  removeLine: (key: string) => void
  /** QRIS dinamis Midtrans aktif → tombol QRIS membuka QR Midtrans untuk bill ini. */
  midtrans: { orderId: string; billId: string } | null
}) {
  // QRIS statis sebagai cadangan saat Midtrans/internet bermasalah.
  const [forceStaticQris, setForceStaticQris] = useState(false)
  return (
    <>
      <div className={`mb-3 grid gap-2 ${methods.length <= 2 ? 'grid-cols-2' : 'grid-cols-4'}`}>
        {methods.map((method) => (
          <button key={method} disabled={remaining <= 0} onClick={() => setActiveModal(method)} className="btn-secondary !min-h-[2.75rem] !py-2 text-sm">
            {METHOD_LABELS[method]}
          </button>
        ))}
      </div>

      {lines.length > 0 && (
        <div className="mb-3 space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center justify-between rounded-xl bg-ink-800 px-4 py-2.5">
              <span className="text-ink-200">
                {line.methodLabel}
                {line.gateway && <span className="ml-2 text-xs font-semibold text-success-500">Lunas via Midtrans</span>}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-ink-50">{formatRupiah(line.amount)}</span>
                {!line.gateway && (
                <button
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-lg text-red-400 hover:bg-ink-700"
                  aria-label={`Hapus pembayaran ${line.methodLabel}`}
                  onClick={() => removeLine(line.key)}
                >
                  <Icon name="close" size={16} />
                </button>
                )}
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
      {activeModal === 'qris' && midtrans && !forceStaticQris && (
        <MidtransQrisModal
          orderId={midtrans.orderId}
          billId={midtrans.billId}
          amount={remaining}
          onCancel={() => setActiveModal(null)}
          onPaid={({ amount, reference }) => {
            addLine({ method: 'qris', amount, reference, gateway: 'midtrans' })
            setActiveModal(null)
          }}
          onUseStatic={() => setForceStaticQris(true)}
        />
      )}
      {activeModal === 'qris' && (!midtrans || forceStaticQris) && (
        <QrisPaymentModal
          amount={remaining}
          onCancel={() => {
            setForceStaticQris(false)
            setActiveModal(null)
          }}
          onConfirm={() => {
            addLine({ method: 'qris', amount: remaining })
            setForceStaticQris(false)
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
