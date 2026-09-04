import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import {
  completeProduction,
  createProduction,
  deleteDraftProduction,
  InsufficientProductionStockError,
  listProductions,
} from '@/db/repositories/production'
import { compatibleUnits } from '@/lib/units'
import { formatDateTime } from '@/lib/datetime'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import type { StockMovementItemType, UnitOfMeasure, User } from '@/types/domain'

interface DraftInput {
  key: string
  ref: string // "ingredient:<id>" | "product:<id>"
  qty: number
  unit: UnitOfMeasure
}

function parseRef(ref: string): { itemType: StockMovementItemType; itemId: string } {
  const [t, id] = ref.split(':')
  return { itemType: t as StockMovementItemType, itemId: id }
}

export function ProductionPanel({ userId, userName }: { userId: string; userName: string }) {
  const ingredients = useLiveQuery(() => db.ingredients.orderBy('name').toArray(), []) ?? []
  const products = useLiveQuery(() => db.products.filter((p) => p.trackOwnStock).toArray(), []) ?? []
  const runs = useLiveQuery(() => listProductions(), []) ?? []

  const itemByRef = useMemo(() => {
    const m = new Map<string, { name: string; unit: UnitOfMeasure }>()
    for (const i of ingredients) m.set(`ingredient:${i.id}`, { name: i.name, unit: i.unit })
    for (const p of products) m.set(`product:${p.id}`, { name: p.name, unit: p.unit })
    return m
  }, [ingredients, products])

  const [outputRef, setOutputRef] = useState('')
  const [outputQty, setOutputQty] = useState(0)
  const [outputUnit, setOutputUnit] = useState<UnitOfMeasure>('ml')
  const [note, setNote] = useState('')
  const [inputs, setInputs] = useState<DraftInput[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shortId, setShortId] = useState<{ productionId: string; items: string[] } | null>(null)

  const outputUnits = outputRef ? compatibleUnits(itemByRef.get(outputRef)?.unit ?? 'ml') : []

  function addInput() {
    setInputs((p) => [...p, { key: crypto.randomUUID(), ref: '', qty: 0, unit: 'g' }])
  }
  function patchInput(key: string, patch: Partial<DraftInput>) {
    setInputs((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function submit() {
    setError(null)
    setDone(null)
    if (!outputRef || outputQty <= 0) {
      setError('Pilih item hasil & isi jumlahnya.')
      return
    }
    const validInputs = inputs.filter((i) => i.ref && i.qty > 0)
    if (validInputs.length === 0) {
      setError('Tambahkan minimal satu bahan input.')
      return
    }
    setBusy(true)
    try {
      const out = parseRef(outputRef)
      const run = await createProduction({
        outputItemType: out.itemType,
        outputItemId: out.itemId,
        outputQty,
        outputUnit,
        inputs: validInputs.map((i) => ({ ...parseRef(i.ref), qty: i.qty, unit: i.unit })),
        note,
        createdBy: userId,
      })
      try {
        await completeProduction({ productionId: run.id, completedBy: userId, completedByName: userName })
      } catch (e) {
        if (e instanceof InsufficientProductionStockError) {
          setShortId({ productionId: run.id, items: e.items })
          return
        }
        throw e
      }
      setDone(`Produksi ${outputQty} ${outputUnit} ${itemByRef.get(outputRef)?.name} dicatat.`)
      resetForm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencatat produksi.')
    } finally {
      setBusy(false)
    }
  }

  function resetForm() {
    setOutputRef('')
    setOutputQty(0)
    setNote('')
    setInputs([])
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card space-y-3 p-4">
        <h3 className="font-semibold text-ink-50">Catat Produksi / Olahan</h3>
        <p className="text-xs text-ink-500">
          Mengubah bahan menjadi olahan atau produk ber-stok (mis. gula + air → simple syrup). Stok input berkurang,
          stok hasil bertambah.
        </p>

        <div className="grid grid-cols-[1fr_5rem_5rem] gap-2">
          <select className="input-field !min-h-0 !py-2 text-sm" value={outputRef} onChange={(e) => {
            setOutputRef(e.target.value)
            const u = itemByRef.get(e.target.value)?.unit
            if (u) setOutputUnit(u)
          }}>
            <option value="">— Hasil produksi —</option>
            {ingredients.length > 0 && (
              <optgroup label="Bahan olahan">
                {ingredients.map((i) => <option key={i.id} value={`ingredient:${i.id}`}>{i.name}</option>)}
              </optgroup>
            )}
            {products.length > 0 && (
              <optgroup label="Produk ber-stok">
                {products.map((p) => <option key={p.id} value={`product:${p.id}`}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          <input type="number" min={0} className="input-field !min-h-0 !py-2 text-sm" value={outputQty || ''} onChange={(e) => setOutputQty(Number(e.target.value))} placeholder="Jml" />
          <select className="input-field !min-h-0 !py-2 text-sm" value={outputUnit} onChange={(e) => setOutputUnit(e.target.value as UnitOfMeasure)}>
            {(outputUnits.length ? outputUnits : [outputUnit]).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-200">Bahan dipakai</p>
          {inputs.map((row) => {
            const units = row.ref ? compatibleUnits(itemByRef.get(row.ref)?.unit ?? 'g') : ['g', 'kg', 'ml', 'l', 'pcs']
            return (
              <div key={row.key} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2">
                <select className="input-field !min-h-0 !py-2 text-sm" value={row.ref} onChange={(e) => {
                  const u = itemByRef.get(e.target.value)?.unit
                  patchInput(row.key, { ref: e.target.value, unit: u ?? row.unit })
                }}>
                  <option value="">— bahan —</option>
                  <optgroup label="Bahan baku">
                    {ingredients.map((i) => <option key={i.id} value={`ingredient:${i.id}`}>{i.name}</option>)}
                  </optgroup>
                  {products.length > 0 && (
                    <optgroup label="Produk ber-stok">
                      {products.map((p) => <option key={p.id} value={`product:${p.id}`}>{p.name}</option>)}
                    </optgroup>
                  )}
                </select>
                <input type="number" min={0} className="input-field !min-h-0 !py-2 text-sm" value={row.qty || ''} onChange={(e) => patchInput(row.key, { qty: Number(e.target.value) })} placeholder="Jml" />
                <select className="input-field !min-h-0 !py-2 text-sm" value={row.unit} onChange={(e) => patchInput(row.key, { unit: e.target.value as UnitOfMeasure })}>
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <button className="text-ink-500 hover:text-red-400" onClick={() => setInputs((p) => p.filter((r) => r.key !== row.key))}>✕</button>
              </div>
            )
          })}
          <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" onClick={addInput}>+ Bahan</button>
        </div>

        <input className="input-field !min-h-0 !py-2 text-sm" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />

        {error && <p className="text-sm text-red-400">{error}</p>}
        {done && <p className="text-sm text-sage-400">{done}</p>}
        <button className="btn-primary w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Menyimpan…' : 'Catat & Potong Stok'}
        </button>
      </div>

      {shortId && (
        <SupervisorPinModal
          title="Stok Bahan Tidak Cukup"
          description={`Stok tidak mencukupi untuk: ${shortId.items.join(', ')}. Lanjut produksi (stok bahan bisa minus) butuh persetujuan supervisor.`}
          onCancel={() => {
            setShortId(null)
            setError('Draf produksi disimpan — sesuaikan stok lalu selesaikan dari daftar di bawah, atau ulangi.')
          }}
          onApproved={(approver: User) => {
            const { productionId } = shortId
            setShortId(null)
            void completeProduction({
              productionId,
              completedBy: userId,
              completedByName: userName,
              allowNegative: { approverUserId: approver.id, approverName: approver.name },
            })
              .then(() => {
                setDone('Produksi dicatat (stok bahan minus, disetujui supervisor).')
                resetForm()
              })
              .catch((e) => setError(e instanceof Error ? e.message : 'Gagal.'))
          }}
        />
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-200">Riwayat Produksi</h3>
        {runs.length === 0 && <p className="text-sm text-ink-500">Belum ada produksi.</p>}
        {runs.map((r) => (
          <div key={r.id} className="card p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink-50">
                {r.outputQty} {r.outputUnit} {r.outputItemName}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'completed' ? 'bg-sage-600/20 text-sage-400' : 'bg-brown-600/20 text-brown-400'}`}>
                {r.status === 'completed' ? 'Selesai' : 'Draf'}
              </span>
            </div>
            <p className="text-xs text-ink-500">
              {formatDateTime(r.completedAt ?? r.createdAt)} · {r.inputs.map((i) => `${i.qty}${i.unit} ${i.itemName}`).join(', ')}
              {r.note ? ` · ${r.note}` : ''}
            </p>
            {r.status === 'draft' && (
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-primary !min-h-0 !px-3 !py-1 text-xs"
                  onClick={() => void completeProduction({ productionId: r.id, completedBy: userId, completedByName: userName }).catch(() => {})}
                >
                  Selesaikan
                </button>
                <button className="btn-ghost !min-h-0 !px-3 !py-1 text-xs" onClick={() => void deleteDraftProduction(r.id)}>
                  Hapus draf
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
