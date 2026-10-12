import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DEPOSIT_TOPUP_METHODS, listGiftCards } from '@/db/repositories/deposits'
import { cancelPreOrder, createPreOrder, listPreOrders, PRE_ORDER_DUE_SOON_MS, preOrderTotal } from '@/db/repositories/preOrders'
import { listAvailableProducts } from '@/db/repositories/products'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import { formatDate, formatTime, jakartaDateKey, jakartaDateTimeToEpoch, jakartaTimeKey, startOfJakartaDay } from '@/lib/datetime'
import { waLink } from '@/lib/whatsapp'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { PaymentMethod, PreOrderLine, Product, Reservation } from '@/types/domain'

const METHOD_LABELS: Partial<Record<PaymentMethod, string>> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' }
const FULFILLMENT_LABELS = { takeaway: 'Diambil / diantar', dine_in: 'Makan di tempat' } as const
const NO_PRE_ORDERS: Reservation[] = []
const NO_PRODUCTS: Product[] = []

interface Props {
  now: number
  /** Buka pesanan dari pesanan terjadwal. Melempar error bila gagal (mis. shift belum dibuka). */
  onStart: (reservation: Reservation) => void
}

/** Pesanan terjadwal / katering: dicatat hari ini untuk tanggal mendatang, dengan atau tanpa uang muka. */
export function PreOrdersPanel({ now, onStart }: Props) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const actor = { userId: currentUser.id, userName: currentUser.name }
  const all = useLiveQuery(() => listPreOrders(), []) ?? NO_PRE_ORDERS
  // Sisa uang muka per kode voucher — berubah saat dipakai/dikembalikan.
  const balances = useLiveQuery(async () => new Map((await listGiftCards()).map((g) => [g.code, g.balance])), [all])
  const [showNew, setShowNew] = useState(false)
  const [cancelling, setCancelling] = useState<Reservation | null>(null)
  const [showDone, setShowDone] = useState(false)

  const open = all.filter((r) => r.status === 'booked')
  const done = all.filter((r) => r.status !== 'booked').reverse().slice(0, 30)
  const todayStart = startOfJakartaDay()
  let lastDay = ''

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-300">
          {open.length === 0 ? 'Belum ada pesanan terjadwal.' : `${open.length} pesanan menunggu • perkiraan ${formatRupiah(open.reduce((s, r) => s + preOrderTotal(r.preOrder!.lines), 0))}`}
        </p>
        <button className="btn-primary btn-compact ml-auto !px-4" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} className="mr-1 inline" />
          Pesanan Terjadwal Baru
        </button>
      </div>

      <div className="space-y-2">
        {open.map((r) => {
          const pre = r.preOrder!
          const dayKey = jakartaDateKey(r.reservedAt)
          const showDay = dayKey !== lastDay
          lastDay = dayKey
          const overdue = r.reservedAt < now
          const dueSoon = !overdue && r.reservedAt - now <= PRE_ORDER_DUE_SOON_MS
          const depositLeft = pre.depositCode ? (balances?.get(pre.depositCode) ?? pre.depositAmount ?? 0) : 0
          const total = preOrderTotal(pre.lines)
          const remind = waLink(
            r.phone,
            `Halo ${r.customerName}, kami mengingatkan pesanan Anda untuk ${formatDate(r.reservedAt)} pukul ${formatTime(r.reservedAt)}: ${pre.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}.${
              depositLeft > 0 ? ` Uang muka ${formatRupiah(depositLeft)} sudah kami terima, sisa perkiraan ${formatRupiah(Math.max(0, total - depositLeft))}.` : ''
            } Terima kasih.`,
          )
          return (
            <div key={r.id}>
              {showDay && <h3 className="eyebrow mb-2 mt-4">{r.reservedAt >= todayStart && r.reservedAt < todayStart + 86_400_000 ? 'Hari ini' : formatDate(r.reservedAt)}</h3>}
              <div className={`card flex flex-wrap items-start gap-4 p-4 ${overdue ? 'ring-1 ring-red-500' : dueSoon ? 'ring-1 ring-yellow-500' : ''}`}>
                <div className="w-16 flex-none text-center">
                  <p className="font-display text-xl font-bold text-ink-50">{formatTime(r.reservedAt)}</p>
                  {overdue && <p className="text-[0.7rem] font-semibold text-red-400">Terlewat</p>}
                  {dueSoon && <p className="text-[0.7rem] font-semibold text-yellow-400">Siapkan</p>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-50">
                    {r.customerName}
                    <span className="ml-2 text-sm font-normal text-ink-300">{FULFILLMENT_LABELS[pre.fulfillment]}</span>
                  </p>
                  <p className="text-sm text-ink-200">{pre.lines.map((l) => `${l.qty}× ${l.name}${l.note ? ` (${l.note})` : ''}`).join(', ')}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-400">
                    Perkiraan {formatRupiah(total)}
                    {pre.depositCode ? ` · uang muka ${formatRupiah(depositLeft)}` : ' · tanpa uang muka'}
                    {r.phone ? ` · ${r.phone}` : ''}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary btn-compact !px-3 text-sm" aria-label={`Proses pesanan ${r.customerName}`} onClick={() => onStart(r)}>
                    Proses Pesanan
                  </button>
                  {remind && (
                    <a className="btn-secondary btn-compact !px-3 text-sm" href={remind} target="_blank" rel="noreferrer">
                      Ingatkan via WA
                    </a>
                  )}
                  <button className="btn-ghost btn-compact !px-3 text-sm !text-red-400" aria-label={`Batalkan pesanan ${r.customerName}`} onClick={() => setCancelling(r)}>
                    Batal
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {done.length > 0 && (
        <div className="mt-6">
          <button className="btn-ghost btn-compact text-sm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Sembunyikan' : 'Lihat'} riwayat ({done.length})
          </button>
          {showDone && (
            <div className="mt-2 space-y-1">
              {done.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-4 py-2 text-sm">
                  <span className="text-ink-300">
                    {formatDate(r.reservedAt)} {formatTime(r.reservedAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-100">
                    {r.customerName} · {r.preOrder!.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                  </span>
                  <span className={r.status === 'seated' ? 'text-success-500' : 'text-ink-400'}>{r.status === 'seated' ? 'Diproses' : 'Dibatalkan'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showNew && (
        <PreOrderFormModal
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            const created = await createPreOrder(input, actor)
            setShowNew(false)
            toast.success(`Pesanan ${created.customerName} untuk ${formatDate(created.reservedAt)} ${formatTime(created.reservedAt)} dicatat.`)
          }}
        />
      )}
      {cancelling && <CancelPreOrderModal reservation={cancelling} depositLeft={cancelling.preOrder?.depositCode ? (balances?.get(cancelling.preOrder.depositCode) ?? 0) : 0} actor={actor} onClose={() => setCancelling(null)} />}
    </div>
  )
}

function CancelPreOrderModal({ reservation, depositLeft, actor, onClose }: { reservation: Reservation; depositLeft: number; actor: { userId: string; userName: string }; onClose: () => void }) {
  // null = uang muka tetap disimpan sebagai voucher hadiah tamu.
  const [refundMethod, setRefundMethod] = useState<PaymentMethod | null>(depositLeft > 0 ? 'cash' : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const { refunded } = await cancelPreOrder(reservation.id, { refundMethod: depositLeft > 0 ? refundMethod : null }, actor)
      toast.success(refunded > 0 ? `Pesanan dibatalkan, uang muka ${formatRupiah(refunded)} dikembalikan.` : 'Pesanan terjadwal dibatalkan.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membatalkan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Batalkan Pesanan Terjadwal?</h2>
      <p className="mb-3 text-sm text-ink-400">
        {reservation.customerName} • {formatDate(reservation.reservedAt)} {formatTime(reservation.reservedAt)}
      </p>
      {depositLeft > 0 && (
        <div className="mb-3">
          <p className="mb-2 text-sm text-ink-200">Uang muka {formatRupiah(depositLeft)}:</p>
          <div className="space-y-2">
            {DEPOSIT_TOPUP_METHODS.filter((m) => m === 'cash' || m === 'transfer').map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-ink-100">
                <input type="radio" name="refund" checked={refundMethod === m} onChange={() => setRefundMethod(m)} />
                Kembalikan ke tamu ({METHOD_LABELS[m]})
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-ink-100">
              <input type="radio" name="refund" checked={refundMethod === null} onChange={() => setRefundMethod(null)} />
              Tidak dikembalikan — tetap tersimpan sebagai voucher hadiah {reservation.preOrder?.depositCode}
            </label>
          </div>
        </div>
      )}
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Kembali
        </button>
        <button className="btn-danger flex-[2]" disabled={busy} onClick={() => void submit()}>
          Ya, Batalkan
        </button>
      </div>
    </Modal>
  )
}

function PreOrderFormModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: Parameters<typeof createPreOrder>[0]) => Promise<void> }) {
  const products = useLiveQuery(() => listAvailableProducts(), []) ?? NO_PRODUCTS
  // Default: besok, dibulatkan ke jam penuh berikutnya (tanggal & jam dari nilai yang SAMA).
  const [defaultAt] = useState(() => Math.ceil((Date.now() + 86_400_000) / 3_600_000) * 3_600_000)
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState(jakartaDateKey(defaultAt))
  const [time, setTime] = useState(jakartaTimeKey(defaultAt))
  const [fulfillment, setFulfillment] = useState<'takeaway' | 'dine_in'>('takeaway')
  const [guestCount, setGuestCount] = useState(2)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<PreOrderLine[]>([])
  const [search, setSearch] = useState('')
  const [depositAmount, setDepositAmount] = useState(0)
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('cash')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(0, 8)
  }, [products, search])
  const total = preOrderTotal(lines)

  function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setLines((current) =>
      current.some((l) => l.productId === productId)
        ? current.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l))
        : [...current, { productId, name: product.name, qty: 1, unitPrice: product.price, note: '' }],
    )
  }

  function setQty(productId: string, qty: number) {
    setLines((current) => (qty <= 0 ? current.filter((l) => l.productId !== productId) : current.map((l) => (l.productId === productId ? { ...l, qty } : l))))
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ customerName, phone, reservedAt: jakartaDateTimeToEpoch(date, time), guestCount: fulfillment === 'dine_in' ? guestCount : 1, note, fulfillment, lines, depositAmount, depositMethod })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan pesanan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-4 text-lg font-bold text-ink-50">Pesanan Terjadwal Baru</h2>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Nama pemesan</span>
          <input className="input-field" autoFocus maxLength={60} aria-label="Nama pemesan terjadwal" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">No. HP (untuk pengingat)</span>
          <input className="input-field" inputMode="tel" maxLength={20} aria-label="No. HP pemesan terjadwal" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Tanggal</span>
          <input type="date" className="input-field" aria-label="Tanggal pesanan terjadwal" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Jam (WIB)</span>
          <input type="time" className="input-field" aria-label="Jam pesanan terjadwal" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['takeaway', 'dine_in'] as const).map((f) => (
          <button key={f} className={`btn btn-compact !px-4 text-sm ${fulfillment === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFulfillment(f)}>
            {FULFILLMENT_LABELS[f]}
          </button>
        ))}
        {fulfillment === 'dine_in' && (
          <label className="ml-2 flex items-center gap-2 text-sm text-ink-300">
            Jumlah tamu
            <input type="number" min={1} className="input-field !w-20 !py-1.5" aria-label="Jumlah tamu pesanan terjadwal" value={guestCount} onChange={(e) => setGuestCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </label>
        )}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-ink-200">Menu yang dipesan</h3>
      <input className="input-field mb-2" placeholder="Cari menu…" aria-label="Cari menu pesanan terjadwal" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mb-3 flex flex-wrap gap-2">
        {matches.map((p) => (
          <button key={p.id} className="btn-secondary btn-compact !px-3 text-sm" aria-label={`Tambah ${p.name} ke pesanan terjadwal`} onClick={() => addProduct(p.id)}>
            + {p.name} <span className="ml-1 text-xs opacity-70">{formatRupiah(p.price)}</span>
          </button>
        ))}
        {matches.length === 0 && <p className="text-sm text-ink-500">Menu tidak ditemukan.</p>}
      </div>
      {lines.length > 0 && (
        <div className="mb-3 space-y-2">
          {lines.map((l) => (
            <div key={l.productId} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-800 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-50">{l.name}</span>
              <input
                className="input-field !w-40 !py-1.5 text-sm"
                placeholder="Catatan"
                aria-label={`Catatan ${l.name}`}
                value={l.note}
                onChange={(e) => setLines((c) => c.map((x) => (x.productId === l.productId ? { ...x, note: e.target.value } : x)))}
              />
              <button className="btn-secondary btn-compact !px-3" aria-label={`Kurangi ${l.name}`} onClick={() => setQty(l.productId, l.qty - 1)}>
                −
              </button>
              <input type="number" min={1} className="input-field !w-16 !py-1.5 text-center" aria-label={`Jumlah ${l.name}`} value={l.qty} onChange={(e) => setQty(l.productId, Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              <button className="btn-secondary btn-compact !px-3" aria-label={`Tambah jumlah ${l.name}`} onClick={() => setQty(l.productId, l.qty + 1)}>
                +
              </button>
              <span className="w-24 text-right text-sm tabular-nums text-ink-100">{formatRupiah(l.unitPrice * l.qty)}</span>
            </div>
          ))}
          <p className="text-right text-sm text-ink-300">
            Perkiraan total <span className="font-bold text-ink-50">{formatRupiah(total)}</span> <span className="text-xs">(belum termasuk pajak/service; harga final mengikuti menu saat diproses)</span>
          </p>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Uang muka (opsional)</span>
          <input className="input-field" inputMode="numeric" placeholder="Rp0" aria-label="Uang muka" value={depositAmount ? formatRupiah(depositAmount) : ''} onChange={(e) => setDepositAmount(parseRupiahInput(e.target.value))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Dibayar dengan</span>
          <select className="input-field" aria-label="Cara bayar uang muka" disabled={depositAmount <= 0} value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as PaymentMethod)}>
            {DEPOSIT_TOPUP_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {depositAmount > 0 && <p className="mb-3 text-xs text-ink-400">Uang muka dicatat sebagai titipan (bukan omzet) dan otomatis ditawarkan sebagai pembayaran saat pesanan diproses.</p>}

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-ink-300">Catatan (opsional)</span>
        <input className="input-field" maxLength={160} placeholder='mis. "diantar ke kantor lantai 3", "tanpa sambal"' aria-label="Catatan pesanan terjadwal" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !customerName.trim() || lines.length === 0} onClick={() => void submit()}>
          {busy ? 'Menyimpan...' : 'Simpan Pesanan Terjadwal'}
        </button>
      </div>
    </Modal>
  )
}
