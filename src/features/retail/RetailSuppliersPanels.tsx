import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { createSupplierReturn, listPurchases, listSuppliers, recordPurchasePayment, saveSupplier } from '@/db/repositories/purchasing'
import { findProductByCode } from '@/db/repositories/retail'
import { RETAIL_CARD } from '@/features/retail/retailUi'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { formatDateTime, jakartaDateKey } from '@/lib/datetime'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import { expiryLabel, sortedBatches } from '@/lib/expiryBatches'
import { purchaseBalance, purchasePaid, supplierDebts } from '@/lib/retailAnalysis'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Product, Purchase, PurchasePayment, Supplier } from '@/types/domain'

const SETTLEMENT_LABEL: Record<NonNullable<Purchase['returnSettlement']>, string> = {
  debt: 'Potong hutang',
  refund: 'Uang kembali',
  replace: 'Tukar barang',
}

// ---- Pemasok ----

export function SuppliersPanel() {
  const suppliers = useLiveQuery(() => listSuppliers(), []) ?? []
  const purchases = useLiveQuery(() => listPurchases(2000), []) ?? []
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const debts = new Map(supplierDebts(purchases, jakartaDateKey(Date.now())).map((d) => [d.supplierKey, d]))

  return (
    <>
      <div className="flex flex-none items-center justify-between">
        <p className="text-sm text-ink-300">{suppliers.length} pemasok terdaftar</p>
        <button className="btn-primary !min-h-[3rem] !rounded-xl text-sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> Pemasok baru
        </button>
      </div>
      <div className={`${RETAIL_CARD} flex-none overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-200">
            <tr>
              <th className="px-6 py-3.5 font-medium">Pemasok</th>
              <th className="px-2 py-3.5 font-medium">Kontak</th>
              <th className="px-2 py-3.5 text-center font-medium">Tempo</th>
              <th className="px-2 py-3.5 text-right font-medium">Hutang</th>
              <th className="px-6 py-3.5 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className={`border-t border-ink-600 ${s.active ? '' : 'opacity-50'}`}>
                <td className="px-6 py-3">
                  <p className="text-ink-50">{s.name}</p>
                  <p className="text-xs text-ink-300">{s.note || s.address || '—'}</p>
                </td>
                <td className="px-2 py-3 text-ink-200">{s.phone || '—'}</td>
                <td className="px-2 py-3 text-center text-ink-100">{s.termDays > 0 ? `${s.termDays} hari` : 'Tunai'}</td>
                <td className="px-2 py-3 text-right font-semibold text-ink-50">{formatRupiah(debts.get(s.id)?.outstanding ?? 0)}</td>
                <td className="px-6 py-3 text-right">
                  <button className="text-sm font-medium text-brand-400" onClick={() => setEditing(s)}>
                    Ubah
                  </button>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-ink-300">
                  Belum ada pemasok. Tambahkan supaya pembelian, hutang, dan retur tercatat per pemasok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <SupplierFormModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SupplierFormModal({ initial, onClose }: { initial: Supplier | null; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [termDays, setTermDays] = useState(initial?.termDays ?? 0)
  const [note, setNote] = useState(initial?.note ?? '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    try {
      await saveSupplier({ id: initial?.id, name, phone, address, termDays, note, active })
      toast.success('Pemasok disimpan.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan')
    }
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-lg rounded-3xl bg-ink-900 p-6">
      <h2 className="mb-4 text-xl font-semibold text-ink-50">{initial ? 'Ubah pemasok' : 'Pemasok baru'}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="mb-1 block text-sm text-ink-300">Nama</span>
          <input className="input-field" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Telepon / WA</span>
          <input className="input-field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Tempo bayar (hari, 0 = tunai)</span>
          <input type="number" min={0} className="input-field" value={termDays} onChange={(e) => setTermDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-sm text-ink-300">Alamat</span>
          <input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-sm text-ink-300">Catatan (mis. jadwal kunjungan sales)</span>
          <input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary !rounded-xl" onClick={() => void save()}>
          Simpan
        </button>
      </div>
    </Modal>
  )
}

// ---- Hutang ----

export function DebtPanel() {
  const purchases = useLiveQuery(() => listPurchases(2000), []) ?? []
  const [paying, setPaying] = useState<Purchase | null>(null)
  const today = jakartaDateKey(Date.now())
  const debts = supplierDebts(purchases, today)
  const open = purchases.filter((p) => purchaseBalance(p) > 0).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
  const total = debts.reduce((s, d) => s + d.outstanding, 0)
  const overdue = debts.reduce((s, d) => s + d.overdue, 0)

  return (
    <>
      <div className="grid flex-none grid-cols-3 gap-3">
        <SummaryCard label="Total hutang" value={formatRupiah(total)} />
        <SummaryCard label="Lewat jatuh tempo" value={formatRupiah(overdue)} tone={overdue > 0 ? 'text-red-500' : undefined} />
        <SummaryCard label="Faktur belum lunas" value={String(open.length)} />
      </div>
      {debts.some((d) => d.returnCredit > 0) && (
        <p className="text-xs text-ink-300">Hutang bersih sudah dipotong nilai retur "potong hutang" per pemasok.</p>
      )}
      <div className={`${RETAIL_CARD} flex-none overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-200">
            <tr>
              <th className="px-6 py-3.5 font-medium">Pemasok / faktur</th>
              <th className="px-2 py-3.5 font-medium">Jatuh tempo</th>
              <th className="px-2 py-3.5 text-right font-medium">Total</th>
              <th className="px-2 py-3.5 text-right font-medium">Sudah dibayar</th>
              <th className="px-2 py-3.5 text-right font-medium">Sisa</th>
              <th className="px-6 py-3.5 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {open.map((p) => {
              const late = p.dueDate! < today
              return (
                <tr key={p.id} className="border-t border-ink-600">
                  <td className="px-6 py-3">
                    <p className="text-ink-50">{p.supplierName || 'Tanpa pemasok'}</p>
                    <p className="text-xs text-ink-300">{p.invoiceNo || `Diterima ${p.receivedAt ? formatDateTime(p.receivedAt) : ''}`}</p>
                  </td>
                  <td className={`px-2 py-3 ${late ? 'font-semibold text-red-500' : 'text-ink-200'}`}>
                    {p.dueDate}
                    {late ? ' · lewat' : ''}
                  </td>
                  <td className="px-2 py-3 text-right text-ink-100">{formatRupiah(p.totalCost)}</td>
                  <td className="px-2 py-3 text-right text-ink-100">{formatRupiah(purchasePaid(p))}</td>
                  <td className="px-2 py-3 text-right font-semibold text-ink-50">{formatRupiah(purchaseBalance(p))}</td>
                  <td className="px-6 py-3 text-right">
                    <button className="btn-primary !min-h-[2.5rem] !rounded-xl !px-4 text-xs" onClick={() => setPaying(p)}>
                      Bayar
                    </button>
                  </td>
                </tr>
              )
            })}
            {open.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-ink-300">
                  Tidak ada hutang ke pemasok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paying && <PayDebtModal purchase={paying} onClose={() => setPaying(null)} />}
    </>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`${RETAIL_CARD} px-5 py-4`}>
      <p className="text-sm text-ink-300">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? 'text-ink-50'}`}>{value}</p>
    </div>
  )
}

export function PayDebtModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const balance = purchaseBalance(purchase)
  const [amount, setAmount] = useState(balance)
  const [method, setMethod] = useState<PurchasePayment['method']>('transfer')
  const [fromDrawer, setFromDrawer] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function pay() {
    setSaving(true)
    setError(null)
    try {
      await recordPurchasePayment({ purchaseId: purchase.id, amount, method, fromDrawer: method === 'cash' && fromDrawer, note, actor: { userId: currentUser.id, userName: currentUser.name } })
      toast.success('Pembayaran hutang tercatat.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencatat pembayaran')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-md rounded-3xl bg-ink-900 p-6">
      <h2 className="text-xl font-semibold text-ink-50">Bayar hutang</h2>
      <p className="mb-4 text-sm text-ink-300">
        {purchase.supplierName} · sisa {formatRupiah(balance)} · jatuh tempo {purchase.dueDate}
      </p>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Jumlah</span>
        <input className="input-field" inputMode="numeric" value={formatRupiah(amount)} onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
      </label>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(['transfer', 'cash', 'other'] as const).map((m) => (
          <button key={m} aria-pressed={method === m} className={`btn btn-compact text-sm ${method === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod(m)}>
            {m === 'transfer' ? 'Transfer' : m === 'cash' ? 'Tunai' : 'Lainnya'}
          </button>
        ))}
      </div>
      {method === 'cash' && (
        <label className="mb-3 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} /> Ambil dari laci kas shift (tercatat kas keluar)
        </label>
      )}
      <input className="input-field mb-3" placeholder="Catatan (mis. no. bukti transfer)" value={note} onChange={(e) => setNote(e.target.value)} />
      {(purchase.payments ?? []).length > 0 && (
        <div className="mb-3 rounded-xl bg-ink-800 p-3 text-xs text-ink-200">
          {purchase.payments!.map((p) => (
            <p key={p.id}>
              {formatDateTime(p.at)} · {formatRupiah(p.amount)} · {p.method}
              {p.note ? ` · ${p.note}` : ''} · {p.byName}
            </p>
          ))}
        </div>
      )}
      {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary !rounded-xl" disabled={saving || amount <= 0} onClick={() => void pay()}>
          Simpan pembayaran
        </button>
      </div>
    </Modal>
  )
}

// ---- Retur ke pemasok ----

export function ReturnsPanel() {
  const purchases = useLiveQuery(() => listPurchases(2000), []) ?? []
  const [creating, setCreating] = useState(false)
  const returns = purchases.filter((p) => p.docType === 'return')

  return (
    <>
      <div className="flex flex-none items-center justify-between">
        <p className="text-sm text-ink-300">Barang rusak/kedaluwarsa yang dikembalikan ke pemasok. Stok langsung berkurang.</p>
        <button className="btn-primary !min-h-[3rem] !rounded-xl text-sm" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Retur baru
        </button>
      </div>
      <div className={`${RETAIL_CARD} flex-none overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-200">
            <tr>
              <th className="px-6 py-3.5 font-medium">Pemasok</th>
              <th className="px-2 py-3.5 font-medium">Tanggal</th>
              <th className="px-2 py-3.5 font-medium">Produk</th>
              <th className="px-2 py-3.5 text-right font-medium">Nilai</th>
              <th className="px-6 py-3.5 text-right font-medium">Penyelesaian</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id} className="border-t border-ink-600">
                <td className="px-6 py-3">
                  <p className="text-ink-50">{r.supplierName}</p>
                  <p className="text-xs text-ink-300">{r.note || '—'}</p>
                </td>
                <td className="px-2 py-3 text-ink-200">{formatDateTime(r.createdAt)}</td>
                <td className="px-2 py-3 text-ink-100">{r.lines.map((l) => `${l.itemName} ×${l.qty}`).join(', ')}</td>
                <td className="px-2 py-3 text-right font-semibold text-ink-50">{formatRupiah(r.totalCost)}</td>
                <td className="px-6 py-3 text-right text-ink-200">{SETTLEMENT_LABEL[r.returnSettlement ?? 'replace']}</td>
              </tr>
            ))}
            {returns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-ink-300">
                  Belum ada retur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {creating && <SupplierReturnModal onClose={() => setCreating(false)} />}
    </>
  )
}

interface ReturnLine {
  product: Product
  qty: number
  cost: number
  batchId: string
}

function SupplierReturnModal({ onClose }: { onClose: () => void }) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const suppliers = (useLiveQuery(() => listSuppliers(), []) ?? []).filter((s) => s.active)
  const products = useLiveQuery(() => db.products.filter((p) => p.trackOwnStock && !p.archived && p.stockQty > 0).sortBy('name'), []) ?? []
  const [supplierId, setSupplierId] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [settlement, setSettlement] = useState<NonNullable<Purchase['returnSettlement']>>('debt')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const now = Date.now()

  const matches = pick.trim() ? products.filter((p) => p.name.toLowerCase().includes(pick.trim().toLowerCase()) || (p.barcode ?? '') === pick.trim()).slice(0, 6) : []
  useBarcodeScanner(
    (code) =>
      void findProductByCode(code).then((p) => {
        if (p && p.stockQty > 0) add(p)
        else toast.warning('Produk tidak ditemukan / stok kosong')
      }),
    { inModal: true },
  )

  function add(p: Product) {
    if (!lines.some((l) => l.product.id === p.id)) {
      // Default: batch yang sudah/hampir exp lebih dulu.
      const batch = sortedBatches(p.expiryBatches)[0]
      setLines([...lines, { product: p, qty: Math.min(1, p.stockQty), cost: p.costPrice, batchId: batch?.id ?? '' }])
    }
    setPick('')
  }

  async function save() {
    const name = suppliers.find((s) => s.id === supplierId)?.name ?? supplierName.trim()
    if (!name) return setError('Pilih atau isi nama pemasok.')
    setSaving(true)
    setError(null)
    try {
      await createSupplierReturn({
        supplierId: supplierId || null,
        supplierName: name,
        settlement,
        note,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitCost: l.cost, batchId: l.batchId || null })),
        actor: { userId: currentUser.id, userName: currentUser.name },
      })
      toast.success('Retur tercatat — stok berkurang.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan retur')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-ink-900 p-6">
      <h2 className="mb-4 text-xl font-semibold text-ink-50">Retur ke pemasok</h2>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {suppliers.length > 0 ? (
          <select className="input-field" aria-label="Pemasok" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Pilih pemasok —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <input className="input-field" placeholder="Nama pemasok" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
        )}
        <input className="input-field" placeholder="Alasan (mis. kemasan rusak, exp)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(['debt', 'refund', 'replace'] as const).map((s) => (
          <button key={s} aria-pressed={settlement === s} className={`btn btn-compact text-sm ${settlement === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSettlement(s)}>
            {SETTLEMENT_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="relative mb-3">
        <input
          className="input-field"
          placeholder="Tambah produk: cari nama atau scan barcode..."
          data-scan-input
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !pick.trim()) return
            if (matches.length === 1) add(matches[0]!)
            else
              void findProductByCode(pick).then((p) => {
                if (p && p.stockQty > 0) add(p)
                else toast.warning('Produk tidak ditemukan / stok kosong')
              })
          }}
        />
        {matches.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-pop">
            {matches.map((p) => (
              <button key={p.id} className="flex w-full justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-800" onClick={() => add(p)}>
                <span className="text-ink-50">{p.name}</span>
                <span className="text-xs text-ink-300">stok {p.stockQty}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-ink-300">
          <tr>
            <th className="py-2 font-medium">Produk</th>
            <th className="py-2 font-medium">Batch</th>
            <th className="py-2 text-center font-medium">Jumlah</th>
            <th className="py-2 text-right font-medium">Nilai / pcs</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.product.id} className="border-t border-ink-600">
              <td className="py-2.5 text-ink-50">
                {l.product.name}
                <p className="text-xs text-ink-300">stok {l.product.stockQty}</p>
              </td>
              <td className="py-2.5">
                {(l.product.expiryBatches?.length ?? 0) > 0 ? (
                  <select
                    className="rounded-lg border border-ink-600 bg-ink-900 px-1.5 py-1.5 text-xs text-ink-100"
                    aria-label={`Batch ${l.product.name}`}
                    value={l.batchId}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, batchId: e.target.value } : x)))}
                  >
                    <option value="">Terlama dulu</option>
                    {sortedBatches(l.product.expiryBatches).map((b) => (
                      <option key={b.id} value={b.id}>
                        {expiryLabel(b.expiryDate, now)} · {b.qty} pcs
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-ink-300">—</span>
                )}
              </td>
              <td className="py-2.5 text-center">
                <input
                  className="w-16 rounded-lg border border-ink-600 px-2 py-1.5 text-center text-ink-50"
                  inputMode="numeric"
                  aria-label={`Jumlah retur ${l.product.name}`}
                  value={l.qty}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)))}
                />
              </td>
              <td className="py-2.5 text-right">
                <input
                  className="w-28 rounded-lg border border-ink-600 px-2 py-1.5 text-right text-ink-50"
                  inputMode="numeric"
                  aria-label={`Nilai retur ${l.product.name}`}
                  value={formatRupiah(l.cost)}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: parseRupiahInput(e.target.value) } : x)))}
                />
              </td>
              <td className="py-2.5 text-right">
                <button className="text-red-500" aria-label={`Hapus ${l.product.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  <Icon name="close" size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-4">
        <p className="text-lg font-semibold text-ink-50">Nilai retur {formatRupiah(lines.reduce((s, l) => s + Math.round(l.qty * l.cost), 0))}</p>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary !rounded-xl" disabled={saving || !lines.some((l) => l.qty > 0)} onClick={() => void save()}>
            Simpan retur
          </button>
        </div>
      </div>
    </Modal>
  )
}
