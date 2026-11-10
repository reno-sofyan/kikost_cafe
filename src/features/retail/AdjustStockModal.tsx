import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { adjustProductStock } from '@/db/repositories/stock'
import { isValidDateKey } from '@/lib/expiryBatches'
import { jakartaDateKey } from '@/lib/datetime'
import { toast } from '@/state/toastStore'
import { qtyAfterScan } from '@/features/retail/retailHelpers'
import type { Product, StockMovementReason } from '@/types/domain'

type Mode = 'stock_in' | 'stock_out' | 'waste'
const MODES: { id: Mode; label: string }[] = [
  { id: 'stock_in', label: 'Stok Masuk' },
  { id: 'stock_out', label: 'Stok Keluar' },
  { id: 'waste', label: 'Waste' },
]

export function AdjustStockModal({
  product,
  userId,
  initialMode = 'stock_in',
  batchId,
  initialQty,
  onClose,
}: {
  product: Product
  userId: string
  initialMode?: Mode
  /** Waste batch tertentu (tab Kedaluwarsa). */
  batchId?: string
  initialQty?: number
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [unit, setUnit] = useState<'pcs' | 'dus'>('pcs')
  const [qtyText, setQtyText] = useState(initialQty ? String(initialQty) : '')
  const [expiry, setExpiry] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pack = product.packSize && product.packSize > 1 ? product.packSize : null
  const typed = Number(qtyText.replace(/[^\d.]/g, '')) || 0
  const qtyPcs = unit === 'dus' && pack ? typed * pack : typed
  const delta = mode === 'stock_in' ? qtyPcs : -qtyPcs
  const after = Math.round((product.stockQty + delta) * 1000) / 1000
  const today = jakartaDateKey(Date.now())

  async function save() {
    setError(null)
    if (qtyPcs <= 0) return setError('Isi jumlah lebih dari 0.')
    if (mode !== 'stock_in' && after < 0) return setError(`Stok tidak cukup — stok saat ini ${product.stockQty} ${product.unit}.`)
    if (mode === 'stock_in' && expiry && !isValidDateKey(expiry)) return setError('Tanggal kedaluwarsa tidak valid.')
    setSaving(true)
    try {
      await adjustProductStock({
        productId: product.id,
        qtyDelta: delta,
        reason: mode as StockMovementReason,
        userId,
        note: note.trim(),
        expiryDate: mode === 'stock_in' && expiry ? expiry : null,
        batchId,
        restoreAvailability: true,
      })
      toast.success(`Stok ${product.name}: ${after.toLocaleString('id-ID')} ${product.unit}`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan penyesuaian')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-[30rem] rounded-3xl bg-ink-900 p-6 shadow-pop">
      <h2 className="text-xl font-semibold text-ink-100">Sesuaikan Stok</h2>
      <p className="mb-4 text-sm text-ink-200">
        {product.name} · Stok saat ini {product.stockQty.toLocaleString('id-ID')} {product.unit}
      </p>

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-brand-600/5 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`min-h-[2.6rem] rounded-xl text-sm font-medium ${mode === m.id ? 'bg-brand-600/80 text-white' : 'text-ink-100 hover:bg-ink-800'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-sm text-ink-100" htmlFor="adjust-qty">
        Jumlah
      </label>
      <div className="flex items-center rounded-xl border border-ink-600 px-4 focus-within:border-brand-500">
        <input
          id="adjust-qty"
          className="min-h-[3rem] w-full bg-transparent text-lg text-ink-100 outline-none"
          inputMode="numeric"
          autoFocus
          value={qtyText}
          placeholder="0"
          onChange={(e) => setQtyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const r = qtyAfterScan(qtyText, product.barcode)
            setQtyText(String(r.qty))
            if (r.scanned) setUnit('pcs')
          }}
        />
        {pack ? (
          <div className="flex flex-none overflow-hidden rounded-lg border border-ink-600 text-xs">
            {(['pcs', 'dus'] as const).map((u) => (
              <button key={u} className={`px-2.5 py-1.5 ${unit === u ? 'bg-brand-600 text-white' : 'text-ink-200'}`} onClick={() => setUnit(u)}>
                {u}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex-none text-ink-200">{product.unit}</span>
        )}
      </div>
      <p className="mb-3 mt-1 text-xs text-ink-300">
        Masukkan jumlah stok manual atau scan barcode produk untuk mengisi otomatis.{pack ? ` 1 dus = ${pack} ${product.unit}.` : ''}
      </p>

      {mode === 'stock_in' && (
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-100">Tanggal kedaluwarsa (opsional)</span>
          <input type="date" className="input-field" min={today} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
      )}

      <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-800 px-4 py-3.5">
        <span className="text-sm text-ink-100">Stok setelah penyesuaian</span>
        <span className={`font-semibold ${after < 0 ? 'text-red-500' : 'text-ink-100'}`}>
          {after.toLocaleString('id-ID')} {product.unit}
        </span>
      </div>

      <label className="mb-1 block text-sm text-ink-100" htmlFor="adjust-note">
        Catatan (opsional)
      </label>
      <textarea
        id="adjust-note"
        className="input-field min-h-[4.5rem] resize-none"
        placeholder={mode === 'stock_in' ? 'Contoh: pembelian dari supplier' : mode === 'waste' ? 'Contoh: kemasan rusak / kedaluwarsa' : 'Contoh: dipakai sendiri'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="min-h-[2.9rem] rounded-xl text-ink-100 hover:bg-ink-800" onClick={onClose}>
          Batal
        </button>
        <button className="min-h-[2.9rem] rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700 disabled:opacity-50" disabled={saving || qtyPcs <= 0} onClick={() => void save()}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </Modal>
  )
}
