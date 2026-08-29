import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { adjustIngredientStock, createIngredient, listIngredients, listLowStockIngredients } from '@/db/repositories/stock'
import { useSessionStore } from '@/state/sessionStore'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import type { Ingredient, StockMovementReason, UnitOfMeasure } from '@/types/domain'

type Tab = 'bahan' | 'riwayat'
const UNITS: UnitOfMeasure[] = ['pcs', 'g', 'kg', 'ml', 'l']

const REASON_LABELS: Record<StockMovementReason, string> = {
  sale: 'Penjualan',
  return: 'Retur',
  adjustment: 'Penyesuaian',
  waste: 'Waste',
  stock_in: 'Stok Masuk',
  stock_out: 'Stok Keluar',
  initial: 'Awal',
}

export function InventoryScreen() {
  const [tab, setTab] = useState<Tab>('bahan')
  const currentUser = useSessionStore((s) => s.currentUser)!
  const ingredients = useLiveQuery(() => listIngredients(), []) ?? []
  const lowStock = useLiveQuery(() => listLowStockIngredients(), []) ?? []
  const movements = useLiveQuery(() => db.stockMovements.orderBy('createdAt').reverse().limit(200).toArray(), []) ?? []

  const [showNewIngredient, setShowNewIngredient] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<Ingredient | null>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-ink-800 px-6 py-4">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Stok &amp; Bahan Baku</h1>
        {(['bahan', 'riwayat'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`btn !min-h-0 !px-4 !py-2 text-sm capitalize ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'bahan' ? 'Bahan Baku' : 'Riwayat Pergerakan'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {lowStock.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-900/30 p-4 text-sm text-red-300">
            <Icon name="alertTriangle" size={18} />
            {lowStock.length} bahan baku menipis: {lowStock.map((i) => i.name).join(', ')}
          </div>
        )}

        {tab === 'bahan' && (
          <>
            <button className="btn-primary mb-4" onClick={() => setShowNewIngredient(true)}>
              + Bahan Baku Baru
            </button>
            <div className="space-y-2">
              {ingredients.map((ing) => (
                <div key={ing.id} className={`card flex items-center justify-between p-4 ${ing.stockQty <= ing.lowStockThreshold ? 'border-red-800' : ''}`}>
                  <div>
                    <p className="font-semibold text-ink-50">{ing.name}</p>
                    <p className="text-sm text-ink-400">
                      Stok: {ing.stockQty} {ing.unit} • Batas menipis: {ing.lowStockThreshold} {ing.unit}
                    </p>
                  </div>
                  <button className="btn-secondary" onClick={() => setAdjustTarget(ing)}>
                    Sesuaikan Stok
                  </button>
                </div>
              ))}
              {ingredients.length === 0 && <p className="text-ink-500">Belum ada bahan baku</p>}
            </div>
          </>
        )}

        {tab === 'riwayat' && (
          <div className="space-y-2">
            {movements.map((m) => (
              <div key={m.id} className="card flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium text-ink-100">
                    {m.itemName} • {REASON_LABELS[m.reason]}
                  </p>
                  <p className="text-xs text-ink-500">{formatDateTime(m.createdAt)}</p>
                </div>
                <span className={`font-bold ${m.qtyDelta >= 0 ? 'text-sage-500' : 'text-red-400'}`}>
                  {m.qtyDelta >= 0 ? '+' : ''}
                  {m.qtyDelta}
                </span>
              </div>
            ))}
            {movements.length === 0 && <p className="text-ink-500">Belum ada pergerakan stok</p>}
          </div>
        )}
      </div>

      {showNewIngredient && <NewIngredientModal onClose={() => setShowNewIngredient(false)} />}
      {adjustTarget && (
        <AdjustStockModal ingredient={adjustTarget} userId={currentUser.id} onClose={() => setAdjustTarget(null)} />
      )}
    </div>
  )
}

function NewIngredientModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<UnitOfMeasure>('g')
  const [stockQty, setStockQty] = useState(0)
  const [lowStockThreshold, setLowStockThreshold] = useState(0)
  const [costPerUnit, setCostPerUnit] = useState(0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Bahan Baku Baru</h2>
        <input className="input-field mb-3" placeholder="Nama bahan" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input-field mb-3" value={unit} onChange={(e) => setUnit(e.target.value as UnitOfMeasure)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Stok Awal</span>
          <input type="number" className="input-field" value={stockQty} onChange={(e) => setStockQty(Number(e.target.value))} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Batas Stok Menipis</span>
          <input type="number" className="input-field" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Number(e.target.value))} />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Biaya per Satuan</span>
          <input type="number" className="input-field" value={costPerUnit} onChange={(e) => setCostPerUnit(Number(e.target.value))} />
        </label>
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn-primary flex-[2]"
            onClick={async () => {
              if (!name.trim()) return
              await createIngredient({ name: name.trim(), unit, stockQty, lowStockThreshold, costPerUnit })
              onClose()
            }}
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}

function AdjustStockModal({ ingredient, userId, onClose }: { ingredient: Ingredient; userId: string; onClose: () => void }) {
  const [mode, setMode] = useState<StockMovementReason>('stock_in')
  const [qty, setQty] = useState(0)
  const [note, setNote] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-ink-50">Sesuaikan Stok</h2>
        <p className="mb-4 text-sm text-ink-400">
          {ingredient.name} • Stok saat ini: {ingredient.stockQty} {ingredient.unit}
        </p>

        <div className="mb-3 grid grid-cols-3 gap-2">
          {(['stock_in', 'stock_out', 'waste'] as StockMovementReason[]).map((r) => (
            <button key={r} onClick={() => setMode(r)} className={`btn !min-h-0 !py-2 text-xs ${mode === r ? 'btn-primary' : 'btn-secondary'}`}>
              {REASON_LABELS[r]}
            </button>
          ))}
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Jumlah ({ingredient.unit})</span>
          <input type="number" min={0} className="input-field" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Catatan</span>
          <input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn-primary flex-[2]"
            onClick={async () => {
              if (qty <= 0) return
              const delta = mode === 'stock_in' ? qty : -qty
              await adjustIngredientStock({ ingredientId: ingredient.id, qtyDelta: delta, reason: mode, userId, note })
              onClose()
            }}
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
