import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import {
  createStockOpname,
  finalizeStockOpname,
  listStockOpnames,
  saveOpnameCounts,
} from '@/db/repositories/stockOpname'
import { formatDateTime } from '@/lib/datetime'

interface Props {
  userId: string
  userName: string
}

export function StockOpnamePanel({ userId, userName }: Props) {
  const opnames = useLiveQuery(() => listStockOpnames(), []) ?? []
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useLiveQuery(() => (openId ? db.stockOpnames.get(openId) : undefined), [openId])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  async function startNew() {
    setError(null)
    const o = await createStockOpname({ createdBy: userId, note: '' })
    setCounts({})
    setNote('')
    setOpenId(o.id)
  }

  async function handleFinalize() {
    if (!active) return
    setError(null)
    const parsed: Record<string, number | null> = {}
    for (const line of active.lines) {
      const raw = counts[line.itemId]
      parsed[line.itemId] = raw === undefined || raw === '' ? null : Number(raw)
    }
    try {
      await saveOpnameCounts(active.id, parsed)
      await finalizeStockOpname({ opnameId: active.id, finalizedBy: userId, finalizedByName: userName, note })
      setOpenId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal finalisasi opname')
    }
  }

  if (openId && active && active.status === 'draft') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink-100">Hitung Fisik — {formatDateTime(active.createdAt)}</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="space-y-1">
          {active.lines.map((line) => {
            const raw = counts[line.itemId] ?? ''
            const delta = raw === '' ? null : Number(raw) - line.systemQty
            return (
              <div key={line.itemId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-ink-200">{line.itemName}</span>
                <span className="w-24 text-right text-ink-500">
                  sistem: {line.systemQty} {line.unit}
                </span>
                <input
                  type="number"
                  step="any"
                  className="input-field w-24"
                  placeholder="fisik"
                  value={raw}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [line.itemId]: e.target.value }))}
                />
                <span className={`w-16 text-right text-xs ${delta ? (delta > 0 ? 'text-sage-500' : 'text-red-400') : 'text-ink-600'}`}>
                  {delta === null ? '' : delta > 0 ? `+${delta}` : delta}
                </span>
              </div>
            )
          })}
        </div>
        <input className="input-field" placeholder="Alasan / catatan opname (wajib)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={() => setOpenId(null)}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" disabled={!note.trim()} onClick={() => void handleFinalize()}>
            Finalisasi &amp; Sesuaikan Stok
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button className="btn-primary" onClick={() => void startNew()}>
        + Opname Baru
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {opnames.map((o) => (
        <div key={o.id} className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink-50">{formatDateTime(o.createdAt)}</p>
              <p className="text-xs text-ink-500">
                {o.status === 'finalized'
                  ? `Selesai • ${o.lines.filter((l) => l.countedQty != null && l.countedQty !== l.systemQty).length} penyesuaian`
                  : 'Draf'}
                {o.note ? ` • ${o.note}` : ''}
              </p>
            </div>
            {o.status === 'draft' && (
              <button className="btn-secondary !min-h-0 !px-3 !py-1 text-xs" onClick={() => { setOpenId(o.id); setCounts({}); setNote(o.note) }}>
                Lanjutkan
              </button>
            )}
          </div>
        </div>
      ))}
      {opnames.length === 0 && <p className="text-sm text-ink-500">Belum ada opname</p>}
    </div>
  )
}
