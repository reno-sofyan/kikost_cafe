import { Button } from '@/components/ui/Button'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { getOrder, listOrderItems } from '@/db/repositories/orders'
import { getSettings } from '@/db/repositories/settings'
import { implicitBillId } from '@/db/repositories/billing'
import { finalizePayment, InsufficientStockError, OrderAlreadyFinalizedError } from '@/db/repositories/checkout'
import { markOrderNotaSaved } from '@/db/repositories/retail'
import { prepareReceiptData, saveReceiptAsPdf } from '@/features/printing/printReceipt'
import { openCashDrawerForPayment } from '@/features/printing/cashDrawer'
import { warmUpStationPrinters } from '@/db/repositories/printQueue'
import { PaymentSuccessScreen } from '@/features/payments/PaymentSuccessScreen'
import { QrisPaymentModal } from '@/features/payments/QrisPaymentModal'
import { MidtransQrisModal } from '@/features/payments/MidtransQrisModal'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { discountLinesOf } from '@/lib/promos'
import { publishCustomerDisplay } from '@/lib/customerDisplay'
import { useSubmitGuard } from '@/lib/useSubmitGuard'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { PaymentInput, User } from '@/types/domain'

type RetailMethod = 'cash' | 'qris' | 'card' | 'split'
const METHODS: { id: RetailMethod; label: string }[] = [
  { id: 'cash', label: 'Tunai' },
  { id: 'qris', label: 'QRIS' },
  { id: 'card', label: 'Debit' },
  { id: 'split', label: 'Campur' },
]

const PREF_PDF = 'kione.retail.exportNotaPdf'
const PREF_SAVE = 'kione.retail.saveNotaToReport'

function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* preferensi perangkat — boleh hilang */
  }
}

/** Pecahan uang yang lazim diterima, ≥ total. */
function quickAmounts(total: number): number[] {
  const notes = [10_000, 20_000, 50_000, 100_000]
  const out = new Set<number>()
  for (const n of notes) out.add(Math.ceil(total / n) * n)
  return [...out].filter((v) => v > total).sort((a, b) => a - b).slice(0, 3)
}

export function RetailPaymentScreen() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!
  const order = useLiveQuery(() => (orderId ? getOrder(orderId) : undefined), [orderId])
  const items = useLiveQuery(() => (orderId ? listOrderItems(orderId) : []), [orderId]) ?? []
  const midtrans = useLiveQuery(async () => (await getSettings()).qrisProvider === 'midtrans', []) ?? false
  const priorPaid =
    useLiveQuery(async () => (orderId ? (await db.payments.where('orderId').equals(orderId).toArray()).reduce((s, p) => s + Math.max(0, p.amount), 0) : 0), [orderId]) ?? 0

  const [method, setMethod] = useState<RetailMethod>('cash')
  const [cashText, setCashText] = useState('')
  const [reference, setReference] = useState('')
  /** Bayar campur: sisa setelah tunai dibayar dengan metode ini. */
  const [splitRest, setSplitRest] = useState<'qris' | 'card'>('qris')
  const [exportPdf, setExportPdf] = useState(() => readPref(PREF_PDF))
  const [saveNota, setSaveNota] = useState(() => readPref(PREF_SAVE))
  const [qrisOpen, setQrisOpen] = useState(false)
  const [useStaticQris, setUseStaticQris] = useState(false)
  const [stockOverride, setStockOverride] = useState<{ items: string[]; payments: PaymentInput[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    void warmUpStationPrinters(['cashier']).catch(() => {})
  }, [])
  useEffect(() => {
    if (orderId) publishCustomerDisplay(qrisOpen ? { orderId, stage: 'qris', amount: qrisOpenAmountRef.current } : { orderId, stage: 'payment' })
  }, [orderId, qrisOpen])

  const due = Math.max(0, (order?.grandTotal ?? 0) - priorPaid)
  const received = parseRupiahInput(cashText)
  const change = received - due
  // Campur: tunai harus kurang dari tagihan (sisanya non-tunai).
  const splitCash = Math.min(received, Math.max(0, due - 1))
  const splitRemainder = due - splitCash
  /** Tagihan QRIS yang ditampilkan: seluruhnya, atau sisa setelah tunai (campur). */
  const qrisAmount = method === 'split' ? splitRemainder : due
  const qrisOpenAmountRef = useRef(qrisAmount)
  qrisOpenAmountRef.current = qrisAmount

  async function settle(payments: PaymentInput[], allowNegativeStock?: { approverUserId: string; approverName: string }) {
    if (!order) return
    setError(null)
    try {
      await finalizePayment({ orderId: order.id, payments, confirmedByUserId: currentUser.id, allowNegativeStock })
      openCashDrawerForPayment(payments.map((p) => p.method))
    } catch (e) {
      if (e instanceof InsufficientStockError) return setStockOverride({ items: e.items, payments })
      if (!(e instanceof OrderAlreadyFinalizedError)) return setError(e instanceof Error ? e.message : 'Gagal menyelesaikan pembayaran')
    }
    // Nota: kegagalan di sini tak membatalkan pembayaran yang sudah tercatat.
    if (saveNota) await markOrderNotaSaved(order.id).catch(() => toast.error('Nota gagal disimpan ke Laporan'))
    if (exportPdf) {
      const paid = await getOrder(order.id)
      if (paid) void prepareReceiptData(paid).then(saveReceiptAsPdf).catch(() => toast.error('Nota PDF gagal dibuat'))
    }
    setCompleted(true)
  }

  const [submitting, submit] = useSubmitGuard(async () => {
    if (method === 'cash') {
      if (received < due) return setError(`Uang diterima kurang ${formatRupiah(due - received)}`)
      return settle([{ method: 'cash', amount: due, receivedAmount: received }])
    }
    if (method === 'split') {
      if (splitCash <= 0) return setError('Isi jumlah tunai yang dibayar pelanggan.')
      if (splitRest === 'qris') return setQrisOpen(true)
      return settle([
        { method: 'cash', amount: splitCash, receivedAmount: splitCash },
        { method: 'card', amount: splitRemainder, reference: reference.trim() || undefined },
      ])
    }
    if (method === 'qris') return setQrisOpen(true)
    return settle([{ method: 'card', amount: due, reference: reference.trim() || undefined }])
  })

  /** QRIS terkonfirmasi: lunasi seluruhnya, atau tunai + sisa QRIS (campur). */
  function settleQris(amount: number, extra: Partial<PaymentInput> = {}) {
    const qris: PaymentInput = { method: 'qris', amount, ...extra }
    void settle(method === 'split' ? [{ method: 'cash', amount: splitCash, receivedAmount: splitCash }, qris] : [qris])
  }

  // Pemindai di layar bayar: karakternya jangan sampai jadi "uang diterima" (13 digit!)
  // dan Enter-nya jangan menyelesaikan pembayaran. Barang ditambah lewat Kasir.
  useBarcodeScanner((_code, { target }) => {
    if (target instanceof HTMLInputElement && (target.id === 'cash-received' || target.id === 'split-cash')) setCashText('')
    setError('Barcode terbaca di layar pembayaran — tekan Kembali untuk menambah barang ke keranjang.')
  }, { enabled: !completed && order?.lifecycleStatus !== 'COMPLETED' })

  // F9 = selesaikan pembayaran dari mana saja di layar ini.
  const submitRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9') return
      e.preventDefault()
      submitRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!order || !orderId) return <div className="flex h-full items-center justify-center text-ink-400">Memuat pesanan...</div>
  if (completed || order.lifecycleStatus === 'COMPLETED') return <PaymentSuccessScreen orderId={order.id} />

  const activeItems = items.filter((i) => !i.voided && !i.removed)
  const canSubmit = due > 0 && activeItems.length > 0 && (method !== 'cash' || received >= due) && (method !== 'split' || splitCash > 0)
  submitRef.current = () => {
    if (canSubmit && !submitting && !qrisOpen && !stockOverride) submit()
  }

  return (
    <div className="flex h-full gap-4 px-5 pb-5 pt-2">
      {/* Ringkasan */}
      <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-ink-600 bg-ink-900 p-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-300">Ringkasan Pesanan</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 border-b border-ink-600 py-3.5 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-[0.95rem] text-ink-100">{item.productName}</p>
                <p className="text-xs text-ink-300">
                  {item.qty} × {formatRupiah(item.unitPrice)}
                </p>
              </div>
              <span className="flex-none font-semibold text-ink-100">{formatRupiah(item.lineTotal)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-sm text-ink-200">
          {discountLinesOf(order).map((d) => (
            <div key={d.label} className="flex justify-between">
              <span>{d.label}</span>
              <span>-{formatRupiah(d.amount)}</span>
            </div>
          ))}
          {order.taxAmount > 0 && (
            <div className="flex justify-between">
              <span>Pajak ({order.taxPercent}%)</span>
              <span>{formatRupiah(order.taxAmount)}</span>
            </div>
          )}
          {priorPaid > 0 && (
            <div className="flex justify-between">
              <span>Sudah dibayar</span>
              <span>-{formatRupiah(priorPaid)}</span>
            </div>
          )}
        </div>
        <div className="mt-3 rounded-2xl bg-ink-800 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-ink-200">
            <span>Total tagihan</span>
            <span>{activeItems.length} Item</span>
          </div>
          <p className="mt-1 text-[2rem] font-bold leading-tight text-brand-400">{formatRupiah(due)}</p>
        </div>
      </div>

      {/* Pembayaran */}
      {/* Isi panel boleh digulir di layar pendek (mis. Tab S5e dengan zoom layar besar), tapi
          tombol Kembali / Selesaikan tetap menempel di bawah — tak pernah terpotong. */}
      <div className="flex w-[29rem] flex-none flex-col rounded-2xl border border-ink-600 bg-ink-900">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
          <p className="mb-3 text-sm font-medium text-ink-100">Metode pembayaran</p>
          <div className="mb-5 grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                aria-pressed={method === m.id}
                onClick={() => {
                  setMethod(m.id)
                  setError(null)
                }}
                className={`min-h-[3rem] rounded-xl border text-sm font-semibold transition-colors ${
                  method === m.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-600 bg-ink-900 text-ink-100 hover:bg-ink-800'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {method === 'cash' && (
            <>
              <label className="mb-2 block text-sm text-ink-100" htmlFor="cash-received">
                Uang diterima
              </label>
              <div className="mb-2 flex items-center rounded-2xl border border-ink-600 px-5 focus-within:border-brand-500">
                <span className="text-lg text-ink-300">Rp</span>
                <input
                  id="cash-received"
                  className="min-h-[4.25rem] w-full bg-transparent text-right text-[2rem] font-bold text-brand-400 outline-none placeholder:text-ink-500"
                  inputMode="numeric"
                  placeholder="0"
                  autoFocus
                  value={cashText}
                  onChange={(e) => {
                    const n = parseRupiahInput(e.target.value)
                    setCashText(n > 0 ? formatNumber(n) : '')
                    setError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit) submit()
                  }}
                />
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                <button className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800" onClick={() => setCashText(formatNumber(due))}>
                  Uang pas
                </button>
                {quickAmounts(due).map((v) => (
                  <button key={v} className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800" onClick={() => setCashText(formatNumber(v))}>
                    {formatNumber(v)}
                  </button>
                ))}
              </div>
              <div className={`mb-4 flex items-center justify-between rounded-2xl px-6 py-5 text-white ${change >= 0 || !cashText ? 'bg-brand-600' : 'bg-red-700'}`}>
                <span className="text-sm">{change >= 0 || !cashText ? 'Kembalian' : 'Kurang'}</span>
                <span className="text-[1.6rem] font-bold">{formatRupiah(cashText ? Math.abs(change) : 0)}</span>
              </div>
            </>
          )}

          {method === 'split' && (
            <>
              <label className="mb-2 block text-sm text-ink-100" htmlFor="split-cash">
                Dibayar tunai
              </label>
              <div className="mb-3 flex items-center rounded-2xl border border-ink-600 px-5 focus-within:border-brand-500">
                <span className="text-lg text-ink-300">Rp</span>
                <input
                  id="split-cash"
                  className="min-h-[3.75rem] w-full bg-transparent text-right text-[1.6rem] font-bold text-brand-400 outline-none placeholder:text-ink-500"
                  inputMode="numeric"
                  placeholder="0"
                  autoFocus
                  value={cashText}
                  onChange={(e) => {
                    const n = parseRupiahInput(e.target.value)
                    setCashText(n > 0 ? formatNumber(n) : '')
                    setError(null)
                  }}
                />
              </div>
              <p className="mb-2 text-sm text-ink-100">Sisa dibayar dengan</p>
              <div className="mb-3 grid grid-cols-2 gap-2">
                {(['qris', 'card'] as const).map((m) => (
                  <button
                    key={m}
                    aria-pressed={splitRest === m}
                    onClick={() => setSplitRest(m)}
                    className={`min-h-[2.75rem] rounded-xl border text-sm font-semibold ${splitRest === m ? 'border-brand-600 bg-brand-600/10 text-brand-400' : 'border-ink-600 text-ink-100'}`}
                  >
                    {m === 'qris' ? 'QRIS' : 'Debit'}
                  </button>
                ))}
              </div>
              {splitRest === 'card' && (
                <input className="input-field mb-3" placeholder="No. referensi EDC (opsional)" aria-label="No. referensi EDC" value={reference} onChange={(e) => setReference(e.target.value)} />
              )}
              <div className="mb-4 flex items-center justify-between rounded-2xl bg-brand-600 px-6 py-4 text-white">
                <span className="text-sm">Sisa {splitRest === 'qris' ? 'QRIS' : 'Debit'}</span>
                <span className="text-[1.4rem] font-bold">{formatRupiah(splitCash > 0 ? splitRemainder : 0)}</span>
              </div>
              {received >= due && cashText && <p className="mb-3 text-xs text-accent-500">Tunai sudah menutup seluruh tagihan — pakai metode Tunai.</p>}
            </>
          )}

          {method === 'qris' && (
            <p className="mb-4 rounded-2xl bg-ink-800 p-4 text-sm text-ink-200">
              Tekan <span className="font-semibold">Selesaikan pembayaran</span> untuk menampilkan QRIS {formatRupiah(due)} ke pelanggan, lalu konfirmasi setelah dana masuk.
            </p>
          )}

          {method === 'card' && (
            <label className="mb-4 block">
              <span className="mb-2 block text-sm text-ink-100">No. referensi EDC (opsional)</span>
              <input className="input-field" placeholder="mis. 4 digit akhir kartu / no. approval" value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          )}

          <ToggleRow
            label="Export Nota ke PDF"
            checked={exportPdf}
            onChange={(v) => {
              setExportPdf(v)
              writePref(PREF_PDF, v)
            }}
          />
          <ToggleRow
            label="Simpan nota ke Laporan"
            checked={saveNota}
            onChange={(v) => {
              setSaveNota(v)
              writePref(PREF_SAVE, v)
            }}
          />

          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>

        <div className="grid flex-none grid-cols-[1fr_1.9fr] gap-3 px-6 pb-6 pt-4">
          <Button variant="secondary" size="lg" className="text-base font-medium" onClick={() => navigate('/kasir')}>
            Kembali
          </Button>
          <Button size="lg" className="text-base" disabled={!canSubmit} loading={submitting} onClick={() => submit()}>
            Selesaikan pembayaran
          </Button>
        </div>
      </div>

      {qrisOpen && midtrans && !useStaticQris && (
        <MidtransQrisModal
          orderId={order.id}
          billId={implicitBillId(order.id)}
          amount={qrisAmount}
          onCancel={() => setQrisOpen(false)}
          onPaid={({ amount, reference: ref }) => {
            setQrisOpen(false)
            settleQris(amount, { reference: ref, gateway: 'midtrans' })
          }}
          onUseStatic={() => setUseStaticQris(true)}
        />
      )}
      {qrisOpen && (!midtrans || useStaticQris) && (
        <QrisPaymentModal
          amount={qrisAmount}
          onCancel={() => {
            setQrisOpen(false)
            setUseStaticQris(false)
          }}
          onConfirm={() => {
            setQrisOpen(false)
            setUseStaticQris(false)
            settleQris(qrisAmount)
          }}
        />
      )}
      {stockOverride && (
        <SupervisorPinModal
          title="Stok Tidak Cukup"
          description={`Stok tidak mencukupi untuk: ${stockOverride.items.join(', ')}. Lanjut (stok jadi minus) butuh persetujuan supervisor.`}
          onCancel={() => setStockOverride(null)}
          onApproved={(approver: User) => {
            const payments = stockOverride.payments
            setStockOverride(null)
            void settle(payments, { approverUserId: approver.id, approverName: approver.name })
          }}
        />
      )}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-3 flex min-h-[3.75rem] cursor-pointer items-center justify-between rounded-2xl border border-ink-600 px-4">
      <span className="text-[0.95rem] text-brand-400">{label}</span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative h-7 w-12 flex-none rounded-full bg-ink-600 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500"
      />
    </label>
  )
}
