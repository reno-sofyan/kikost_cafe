import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { createPurchase, listPurchases, receivePurchase } from '@/db/repositories/purchasing'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import type { PurchaseLine, StockMovementItemType, UnitOfMeasure } from '@/types/domain'

interface Props {
  userId: string
  userName: string
}

type DraftLine = Omit<PurchaseLine, 'lineCost'>

export function PurchasingPanel({ userId, userName }: Props) {
  const purchases = useLiveQuery(() => listPurchases(), []) ?? []
  const ingredients = useLiveQuery(() => db.ingredients.orderBy('name').toArray(), []) ?? []
  const products = useLiveQuery(() => db.products.filter((p) => p.trackOwnStock).toArray(), []) ?? []
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReceive(id: string) {
    setError(null)
    try {
      await receivePurchase({ purchaseId: id, receivedBy: userId, receivedByName: userName })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menerima pembelian')
    }
  }

  return (
    <div className="space-y-3">
      <button className="btn-primary" onClick={() => setShowForm(true)} disabled={ingredients.length + products.length === 0}>
        + Pembelian Baru
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {purchases.map((p) => (
        <div key={p.id} className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink-50">{p.supplierName || 'Tanpa pemasok'}</p>
              <p className="text-xs text-ink-500">
                {p.invoiceNo ? `${p.invoiceNo} • ` : ''}
                {formatDateTime(p.createdAt)} • {p.lines.length} item
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-brew-400">{formatRupiah(p.totalCost)}</p>
              {p.status === 'received' ? (
                <span className="text-xs text-sage-500">Diterima</span>
              ) : (
                <button className="btn-primary !min-h-0 !px-3 !py-1 text-xs" onClick={() => void handleReceive(p.id)}>
                  Terima Barang
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {purchases.length === 0 && <p className="text-sm text-ink-500">Belum ada pembelian</p>}

      {showForm && (
        <PurchaseFormModal
          ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
          products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
          onClose={() => setShowForm(false)}
          onSave={async (supplierName, invoiceNo, note, lines) => {
            await createPurchase({ supplierName, invoiceNo, note, createdBy: userId, lines })
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function PurchaseFormModal({
  ingredients,
  products,
  onClose,
  onSave,
}: {
  ingredients: { id: string; name: string; unit: UnitOfMeasure }[]
  products: { id: string; name: string; unit: UnitOfMeasure }[]
  onClose: () => void
  onSave: (supplierName: string, invoiceNo: string, note: string, lines: DraftLine[]) => Promise<void>
}) {
  const items = [
    ...ingredients.map((i) => ({ ...i, itemType: 'ingredient' as StockMovementItemType })),
    ...products.map((p) => ({ ...p, itemType: 'product' as StockMovementItemType })),
  ]
  const [supplierName, setSupplierName] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])

  function addLine() {
    const first = items[0]
    if (!first) return
    setLines((prev) => [
      ...prev,
      { itemType: first.itemType, itemId: first.id, itemName: first.name, qty: 1, unit: first.unit, unitCost: 0 },
    ])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Pembelian Baru</h2>
        <input className="input-field mb-2" placeholder="Nama pemasok" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
        <input className="input-field mb-2" placeholder="No. nota (opsional)" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        <input className="input-field mb-3" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />

        {lines.map((line, index) => (
          <div key={index} className="mb-2 flex items-center gap-2">
            <select
              className="input-field flex-1"
              value={line.itemId}
              onChange={(e) => {
                const it = items.find((i) => i.id === e.target.value)!
                setLines((prev) => prev.map((l, i) => (i === index ? { ...l, itemId: it.id, itemName: it.name, itemType: it.itemType, unit: it.unit } : l)))
              }}
            >
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              className="input-field w-16"
              value={line.qty}
              onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, qty: Number(e.target.value) } : l)))}
            />
            <span className="w-8 text-xs text-ink-400">{line.unit}</span>
            <input
              className="input-field w-24"
              inputMode="numeric"
              value={formatRupiah(line.unitCost)}
              onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, unitCost: parseRupiahInput(e.target.value) } : l)))}
            />
            <button type="button" className="text-red-400" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" onClick={addLine} disabled={items.length === 0}>
          + Baris
        </button>

        <div className="mt-4 flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn-primary flex-[2]"
            disabled={lines.length === 0}
            onClick={() => void onSave(supplierName, invoiceNo, note, lines)}
          >
            Simpan Draf
          </button>
        </div>
      </div>
    </div>
  )
}
