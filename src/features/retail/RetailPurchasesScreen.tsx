import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { createPurchase, listPurchases, listSuppliers, receivePurchase } from '@/db/repositories/purchasing'
import { DebtPanel, PayDebtModal, ReturnsPanel, SuppliersPanel } from '@/features/retail/RetailSuppliersPanels'
import { purchaseBalance, purchasePaid, supplierDebts } from '@/lib/retailAnalysis'
import { findProductByCode } from '@/db/repositories/retail'
import { ScannerModal } from '@/features/retail/ScannerModal'
import { ScanButton } from '@/features/retail/ScanButton'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { PillTabs, RETAIL_CARD } from '@/features/retail/retailUi'
import { packBreakdown } from '@/features/retail/retailHelpers'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { formatDateTime, jakartaDateKey } from '@/lib/datetime'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import { isValidDateKey } from '@/lib/expiryBatches'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Product, Purchase, PurchaseLine } from '@/types/domain'

type Filter = 'semua' | 'draft' | 'received'
type Section = 'pembelian' | 'hutang' | 'retur' | 'pemasok'

export function RetailPurchasesScreen() {
  const [section, setSection] = useState<Section>('pembelian')
  const purchases = useLiveQuery(() => listPurchases(2000), []) ?? []
  const overdue = supplierDebts(purchases, jakartaDateKey(Date.now())).some((d) => d.overdue > 0)
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-5 pt-2">
      <div className="flex-none">
        <PillTabs<Section>
          value={section}
          onChange={setSection}
          tabs={[
            { id: 'pembelian', label: 'Pembelian' },
            { id: 'hutang', label: 'Hutang', dot: overdue },
            { id: 'retur', label: 'Retur' },
            { id: 'pemasok', label: 'Pemasok' },
          ]}
        />
      </div>
      {section === 'pembelian' && <PurchasesPanel />}
      {section === 'hutang' && <DebtPanel />}
      {section === 'retur' && <ReturnsPanel />}
      {section === 'pemasok' && <SuppliersPanel />}
    </div>
  )
}

function PurchasesPanel() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const purchases = (useLiveQuery(() => listPurchases(300), []) ?? []).filter((p) => p.docType !== 'return')
  const [filter, setFilter] = useState<Filter>('semua')
  const [showForm, setShowForm] = useState(false)
  const [receiving, setReceiving] = useState<Purchase | null>(null)
  const [viewing, setViewing] = useState<Purchase | null>(null)
  const rows = purchases.filter((p) => filter === 'semua' || p.status === filter)
  const draftCount = purchases.filter((p) => p.status === 'draft').length
  const monthStart = jakartaDateKey(Date.now()).slice(0, 7)
  const monthTotal = purchases.filter((p) => p.status === 'received' && p.receivedAt && jakartaDateKey(p.receivedAt).startsWith(monthStart)).reduce((s, p) => s + p.totalCost, 0)

  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-3">
        <PillTabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'semua', label: 'Semua' },
            { id: 'draft', label: 'Menunggu diterima', dot: draftCount > 0 },
            { id: 'received', label: 'Sudah diterima' },
          ]}
        />
        <p className="mr-auto text-sm text-ink-300">Diterima bulan ini: {formatRupiah(monthTotal)}</p>
        <button className="btn-primary !min-h-[3rem] !rounded-xl text-sm" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={16} /> Pembelian baru
        </button>
      </div>

      <div className={`${RETAIL_CARD} flex-none overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-200">
            <tr>
              <th className="px-6 py-3.5 font-medium">Pemasok</th>
              <th className="px-2 py-3.5 font-medium">Tanggal</th>
              <th className="px-2 py-3.5 text-center font-medium">Produk</th>
              <th className="px-2 py-3.5 text-right font-medium">Total</th>
              <th className="px-2 py-3.5 text-center font-medium">Status</th>
              <th className="px-6 py-3.5 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="cursor-pointer border-t border-ink-600 hover:bg-ink-800/60" onClick={() => setViewing(p)}>
                <td className="px-6 py-3">
                  <p className="text-ink-50">{p.supplierName || 'Tanpa pemasok'}</p>
                  <p className="text-xs text-ink-300">{p.invoiceNo || p.note || '—'}</p>
                </td>
                <td className="px-2 py-3 text-ink-200">{formatDateTime(p.receivedAt ?? p.createdAt)}</td>
                <td className="px-2 py-3 text-center text-ink-100">{p.lines.length}</td>
                <td className="px-2 py-3 text-right font-semibold text-ink-50">{formatRupiah(p.totalCost)}</td>
                <td className="px-2 py-3 text-center">
                  <span className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${p.status === 'received' ? 'border-success-600 text-success-500' : 'border-accent-500 text-accent-400'}`}>
                    {p.status === 'received' ? 'Diterima' : 'Menunggu'}
                  </span>
                  {purchaseBalance(p) > 0 && <p className="mt-0.5 text-xs text-red-500">Hutang {formatRupiah(purchaseBalance(p))}</p>}
                </td>
                <td className="px-6 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  {p.status === 'draft' && (
                    <button className="btn-primary !min-h-[2.5rem] !rounded-xl !px-4 text-xs" onClick={() => setReceiving(p)}>
                      Terima Barang
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-ink-300">
                  Belum ada pembelian.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && <PurchaseFormModal userId={currentUser.id} onClose={() => setShowForm(false)} />}
      {receiving && <ReceivePurchaseModal purchase={receiving} userId={currentUser.id} userName={currentUser.name} onClose={() => setReceiving(null)} />}
      {viewing && <PurchaseDetailModal purchase={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

interface FormLine {
  product: Product
  unit: 'pcs' | 'dus'
  qty: number
  /** Harga beli per satuan yang dipilih (pcs atau dus). */
  cost: number
}

function PurchaseFormModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const products = useLiveQuery(() => db.products.filter((p) => p.trackOwnStock && !p.archived).sortBy('name'), []) ?? []
  const suppliers = (useLiveQuery(() => listSuppliers(), []) ?? []).filter((s) => s.active)
  const [supplierName, setSupplierName] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<FormLine[]>([])
  const [pick, setPick] = useState('')
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)

  function add(product: Product) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id)
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      const dus = product.packSize && product.packSize > 1
      return [...prev, { product, unit: dus ? 'dus' : 'pcs', qty: 1, cost: dus ? product.costPrice * product.packSize! : product.costPrice }]
    })
    setPick('')
  }

  // Pemindai USB di dalam dialog pembelian: barang masuk daftar walau fokus di kolom lain.
  // Dimatikan selama panel Scan terbuka — panel itu yang meneruskan kodenya (tak dobel).
  useBarcodeScanner((code) => void addByCode(code), { inModal: true, enabled: !scanning })

  async function addByCode(code: string) {
    const p = await findProductByCode(code)
    if (p?.trackOwnStock) add(p)
    else toast.warning(`Barcode ${code} belum terdaftar sebagai produk ber-stok`)
  }

  const toPcs = (l: FormLine) => (l.unit === 'dus' && l.product.packSize ? l.qty * l.product.packSize : l.qty)
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.cost), 0)
  const matches = pick.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(pick.trim().toLowerCase()) || (p.barcode ?? '').includes(pick.trim()) || p.sku.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 6)
    : []

  async function save() {
    const draftLines: Omit<PurchaseLine, 'lineCost'>[] = lines
      .filter((l) => l.qty > 0)
      .map((l) => {
        const qty = toPcs(l)
        return { itemType: 'product', itemId: l.product.id, itemName: l.product.name, qty, unit: l.product.unit, unitCost: qty > 0 ? (l.qty * l.cost) / qty : 0 }
      })
    if (draftLines.length === 0) return
    setSaving(true)
    try {
      // Nama yang cocok dengan master pemasok ikut ditautkan (hutang & retur per pemasok).
      const supplier = suppliers.find((s) => s.name.toLowerCase() === supplierName.trim().toLowerCase())
      await createPurchase({ supplierName: supplier?.name ?? supplierName, supplierId: supplier?.id ?? null, invoiceNo, note, createdBy: userId, lines: draftLines })
      toast.success('Draf pembelian tersimpan. Terima barang saat sudah datang.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan pembelian')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-ink-900 p-6">
      <h2 className="mb-4 text-xl font-semibold text-ink-50">Pembelian baru</h2>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <input className="input-field" placeholder="Nama pemasok" list="retail-suppliers" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
        <datalist id="retail-suppliers">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <input className="input-field" placeholder="No. faktur (opsional)" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        <input className="input-field" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="relative mb-3 flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            className="input-field !pl-11"
            placeholder="Tambah produk: cari nama atau scan barcode..."
            data-scan-input
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pick.trim()) {
                e.preventDefault()
                if (matches.length === 1) add(matches[0]!)
                else void addByCode(pick.trim()).then(() => setPick(''))
              }
            }}
          />
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-pop">
              {matches.map((p) => (
                <button key={p.id} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-800" onClick={() => add(p)}>
                  <span className="text-ink-50">{p.name}</span>
                  <span className="text-xs text-ink-300">
                    stok {p.stockQty} · HPP {formatRupiah(p.costPrice)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ScanButton onClick={() => setScanning(true)} />
      </div>

      <table className="mb-3 w-full text-sm">
        <thead className="text-left text-ink-300">
          <tr>
            <th className="py-2 font-medium">Produk</th>
            <th className="py-2 text-center font-medium">Jumlah</th>
            <th className="py-2 text-right font-medium">Harga beli / satuan</th>
            <th className="py-2 text-right font-medium">Subtotal</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const pack = l.product.packSize && l.product.packSize > 1 ? l.product.packSize : null
            return (
              <tr key={l.product.id} className="border-t border-ink-600">
                <td className="py-2.5">
                  <p className="text-ink-50">{l.product.name}</p>
                  {pack && <p className="text-xs text-ink-300">= {toPcs(l).toLocaleString('id-ID')} {l.product.unit}</p>}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center justify-center gap-1.5">
                    <input
                      className="w-16 rounded-lg border border-ink-600 px-2 py-1.5 text-center text-ink-50"
                      inputMode="numeric"
                      value={l.qty}
                      aria-label={`Jumlah ${l.product.name}`}
                      onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)))}
                    />
                    {pack ? (
                      <select
                        className="rounded-lg border border-ink-600 bg-ink-900 px-1.5 py-1.5 text-ink-100"
                        value={l.unit}
                        onChange={(e) => {
                          const unit = e.target.value as 'pcs' | 'dus'
                          setLines((prev) => prev.map((x, j) => (j === i ? { ...x, unit, cost: unit === 'dus' ? x.cost * pack : x.cost / pack } : x)))
                        }}
                      >
                        <option value="dus">dus</option>
                        <option value="pcs">{l.product.unit}</option>
                      </select>
                    ) : (
                      <span className="text-ink-300">{l.product.unit}</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 text-right">
                  <input
                    className="w-28 rounded-lg border border-ink-600 px-2 py-1.5 text-right text-ink-50"
                    inputMode="numeric"
                    value={formatRupiah(Math.round(l.cost))}
                    aria-label={`Harga beli ${l.product.name}`}
                    onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, cost: parseRupiahInput(e.target.value) } : x)))}
                  />
                </td>
                <td className="py-2.5 text-right text-ink-50">{formatRupiah(Math.round(l.qty * l.cost))}</td>
                <td className="py-2.5 text-right">
                  <button className="text-red-500" aria-label={`Hapus ${l.product.name}`} onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                    <Icon name="close" size={16} />
                  </button>
                </td>
              </tr>
            )
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-300">
                Belum ada produk. Cari atau scan barcode di atas.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t border-ink-600 pt-4">
        <p className="text-lg font-semibold text-ink-50">Total {formatRupiah(total)}</p>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary !rounded-xl" disabled={saving || lines.every((l) => l.qty <= 0)} onClick={() => void save()}>
            Simpan Draf
          </button>
        </div>
      </div>

      {scanning && (
        <ScannerModal
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false)
            void addByCode(code)
          }}
        />
      )}
    </Modal>
  )
}

/** Terima barang: jumlah yang benar-benar datang + tanggal kedaluwarsa per baris. */
export function ReceivePurchaseModal({ purchase, userId, userName, onClose }: { purchase: Purchase; userId: string; userName: string; onClose: () => void }) {
  const products = useLiveQuery(() => db.products.bulkGet(purchase.lines.map((l) => l.itemId)), [purchase.id]) ?? []
  const [qty, setQty] = useState<Record<number, string>>({})
  const [exp, setExp] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = jakartaDateKey(Date.now())
  const supplier = useLiveQuery(async () => (await listSuppliers()).find((s) => s.id === purchase.supplierId) ?? null, [purchase.supplierId])
  /** null = ikut tempo pemasok di master. */
  const [termText, setTermText] = useState<string | null>(null)
  const termDays = termText === null ? (supplier?.termDays ?? 0) : Math.max(0, Math.floor(Number(termText) || 0))

  async function receive() {
    setError(null)
    const receivedQtys: Record<number, number> = {}
    for (const [k, v] of Object.entries(qty)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return setError('Jumlah diterima tidak valid.')
      receivedQtys[Number(k)] = n
    }
    for (const v of Object.values(exp)) if (v && !isValidDateKey(v)) return setError('Tanggal kedaluwarsa tidak valid.')
    setSaving(true)
    try {
      await receivePurchase({ purchaseId: purchase.id, receivedBy: userId, receivedByName: userName, receivedQtys, expiryDates: exp, restoreAvailability: true, termDays })
      toast.success('Barang diterima — stok bertambah.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menerima barang')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-ink-900 p-6">
      <h2 className="text-xl font-semibold text-ink-50">Terima Barang</h2>
      <p className="mb-4 text-sm text-ink-300">
        {purchase.supplierName || 'Tanpa pemasok'}
        {purchase.invoiceNo ? ` · ${purchase.invoiceNo}` : ''} · dibuat {formatDateTime(purchase.createdAt)}
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-ink-300">
          <tr>
            <th className="py-2 font-medium">Produk</th>
            <th className="py-2 text-center font-medium">Dipesan</th>
            <th className="py-2 text-center font-medium">Diterima</th>
            <th className="py-2 text-center font-medium">Tanggal kedaluwarsa</th>
          </tr>
        </thead>
        <tbody>
          {purchase.lines.map((l, i) => {
            const product = products[i]
            return (
              <tr key={`${l.itemId}-${i}`} className="border-t border-ink-600">
                <td className="py-2.5">
                  <p className="text-ink-50">{l.itemName}</p>
                  <p className="text-xs text-ink-300">{formatRupiah(Math.round(l.unitCost))} / {l.unit}</p>
                </td>
                <td className="py-2.5 text-center text-ink-100">
                  {l.qty.toLocaleString('id-ID')} {l.unit}
                  {product && packBreakdown(l.qty, product.packSize, l.unit) && <p className="text-xs text-ink-300">{packBreakdown(l.qty, product.packSize, l.unit)}</p>}
                </td>
                <td className="py-2.5 text-center">
                  <input
                    className="w-20 rounded-lg border border-ink-600 px-2 py-1.5 text-center text-ink-50"
                    inputMode="decimal"
                    placeholder={String(l.qty)}
                    value={qty[i] ?? ''}
                    aria-label={`Jumlah diterima ${l.itemName}`}
                    onChange={(e) => setQty((s) => ({ ...s, [i]: e.target.value.replace(/[^\d.]/g, '') }))}
                  />
                </td>
                <td className="py-2.5 text-center">
                  {l.itemType === 'product' ? (
                    <input type="date" className="rounded-lg border border-ink-600 px-2 py-1.5 text-ink-50" min={today} value={exp[i] ?? ''} aria-label={`Kedaluwarsa ${l.itemName}`} onChange={(e) => setExp((s) => ({ ...s, [i]: e.target.value }))} />
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-300">Kosongkan "Diterima" bila jumlahnya sama dengan pesanan. Tanggal kedaluwarsa opsional. HPP produk dihitung ulang (rata-rata tertimbang).</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-ink-600 p-3 text-sm">
        <span className="text-ink-100">Pembayaran</span>
        <button aria-pressed={termDays === 0} className={`btn btn-compact text-sm ${termDays === 0 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTermText('0')}>
          Tunai
        </button>
        <button aria-pressed={termDays > 0} className={`btn btn-compact text-sm ${termDays > 0 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTermText(String(supplier?.termDays || 30))}>
          Tempo
        </button>
        {termDays > 0 && (
          <label className="flex items-center gap-2 text-ink-200">
            <input className="w-16 rounded-lg border border-ink-600 px-2 py-1.5 text-center text-ink-50" inputMode="numeric" aria-label="Tempo (hari)" value={termText ?? String(termDays)} onChange={(e) => setTermText(e.target.value.replace(/\D/g, ''))} />
            hari → dicatat sebagai hutang
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary !rounded-xl" disabled={saving} onClick={() => void receive()}>
          {saving ? 'Menyimpan…' : 'Terima & Tambah Stok'}
        </button>
      </div>
    </Modal>
  )
}

function PurchaseDetailModal({ purchase: initial, onClose }: { purchase: Purchase; onClose: () => void }) {
  const purchase = useLiveQuery(() => db.purchases.get(initial.id), [initial.id]) ?? initial
  const [paying, setPaying] = useState(false)
  const balance = purchaseBalance(purchase)
  return (
    <Modal onClose={onClose} className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-ink-900 p-6">
      <h2 className="text-xl font-semibold text-ink-50">{purchase.supplierName || 'Tanpa pemasok'}</h2>
      <p className="mb-4 text-sm text-ink-300">
        {purchase.invoiceNo ? `${purchase.invoiceNo} · ` : ''}
        {purchase.status === 'received' ? `Diterima ${purchase.receivedAt ? formatDateTime(purchase.receivedAt) : ''}` : `Dibuat ${formatDateTime(purchase.createdAt)} · menunggu diterima`}
      </p>
      <div className="divide-y divide-ink-600 text-sm">
        {purchase.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between py-2.5">
            <div>
              <p className="text-ink-50">{l.itemName}</p>
              <p className="text-xs text-ink-300">
                {l.qty.toLocaleString('id-ID')} {l.unit} × {formatRupiah(Math.round(l.unitCost))}
                {l.expiryDate ? ` · exp ${l.expiryDate}` : ''}
              </p>
            </div>
            <span className="font-semibold text-ink-50">{formatRupiah(l.lineCost)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-right text-lg font-semibold text-ink-50">Total {formatRupiah(purchase.totalCost)}</p>
      {purchase.note && <p className="mt-1 text-sm text-ink-300">Catatan: {purchase.note}</p>}
      {purchase.dueDate && (
        <div className="mt-4 rounded-2xl bg-ink-800 p-4 text-sm">
          <div className="flex items-center justify-between">
            <p className="text-ink-100">
              Tempo s.d. {purchase.dueDate} · dibayar {formatRupiah(purchasePaid(purchase))} · sisa <span className="font-semibold">{formatRupiah(balance)}</span>
            </p>
            {balance > 0 && (
              <button className="btn-primary btn-compact !rounded-xl" onClick={() => setPaying(true)}>
                Bayar
              </button>
            )}
          </div>
          {(purchase.payments ?? []).map((p) => (
            <p key={p.id} className="mt-1 text-xs text-ink-300">
              {formatDateTime(p.at)} · {formatRupiah(p.amount)} · {p.method}
              {p.fromDrawer ? ' (laci kas)' : ''} · {p.byName}
            </p>
          ))}
        </div>
      )}
      {paying && <PayDebtModal purchase={purchase} onClose={() => setPaying(false)} />}
    </Modal>
  )
}
