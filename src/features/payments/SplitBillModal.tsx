import { useMemo, useState } from 'react'
import { splitBillByItems } from '@/db/repositories/billing'
import { formatRupiah } from '@/lib/currency'
import type { OrderItem } from '@/types/domain'

/**
 * Membagi item pesanan ke beberapa "tagihan" (mis. per orang). Setiap item
 * harus masuk tepat satu tagihan. Total tiap tagihan dihitung server-side
 * (`splitBillByItems`) — diskon/pajak/SC dialokasikan proporsional.
 */
export function SplitBillModal({
  orderId,
  items,
  onClose,
  onDone,
}: {
  orderId: string
  items: OrderItem[]
  onClose: () => void
  onDone: () => void
}) {
  const [count, setCount] = useState(2)
  const [assign, setAssign] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((it, i) => [it.id, i === 0 ? 0 : 0])),
  )
  const [labels, setLabels] = useState<string[]>(['Tagihan 1', 'Tagihan 2'])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setBucketCount(n: number) {
    const next = Math.max(2, Math.min(6, n))
    setCount(next)
    setLabels((prev) => Array.from({ length: next }, (_, i) => prev[i] ?? `Tagihan ${i + 1}`))
    setAssign((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, Math.min(v, next - 1)])))
  }

  const subtotals = useMemo(() => {
    const s = Array.from({ length: count }, () => 0)
    for (const it of items) s[assign[it.id] ?? 0] += it.lineTotal
    return s
  }, [assign, count, items])

  async function apply() {
    setError(null)
    const groups: string[][] = Array.from({ length: count }, () => [])
    for (const it of items) groups[assign[it.id] ?? 0].push(it.id)
    if (groups.some((g) => g.length === 0)) {
      setError('Setiap tagihan harus berisi minimal satu item.')
      return
    }
    setBusy(true)
    try {
      await splitBillByItems(orderId, groups, labels)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memecah tagihan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink-50">Pisah Tagihan per Item</h2>
          <button className="text-ink-400" onClick={onClose}>
            tutup
          </button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm text-ink-300">Jumlah tagihan</span>
          <button className="btn-secondary !min-h-0 !px-3 !py-1" onClick={() => setBucketCount(count - 1)}>−</button>
          <span className="font-bold text-ink-50">{count}</span>
          <button className="btn-secondary !min-h-0 !px-3 !py-1" onClick={() => setBucketCount(count + 1)}>+</button>
        </div>

        <div className="mb-4 space-y-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-lg bg-ink-800 p-2.5">
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="text-ink-100">{it.qty}× {it.productName}</span>
                <span className="text-ink-300">{formatRupiah(it.lineTotal)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: count }, (_, b) => (
                  <button
                    key={b}
                    onClick={() => setAssign((p) => ({ ...p, [it.id]: b }))}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      (assign[it.id] ?? 0) === b ? 'bg-brew-600 text-white' : 'bg-ink-700 text-ink-300'
                    }`}
                  >
                    {labels[b] || `#${b + 1}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-4 space-y-2">
          {Array.from({ length: count }, (_, b) => (
            <div key={b} className="flex items-center gap-2">
              <input
                className="input-field !min-h-0 !py-1.5 text-sm"
                value={labels[b] ?? ''}
                onChange={(e) => setLabels((p) => p.map((l, i) => (i === b ? e.target.value : l)))}
              />
              <span className="w-28 flex-none text-right text-sm font-semibold text-ink-100">≈ {formatRupiah(subtotals[b])}</span>
            </div>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <p className="mb-3 text-xs text-ink-500">Estimasi di atas hanya subtotal. Diskon, pajak & service charge dialokasikan proporsional saat tagihan dibuat.</p>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>Batal</button>
          <button className="btn-primary flex-[2]" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Memproses…' : 'Buat Tagihan Terpisah'}
          </button>
        </div>
      </div>
    </div>
  )
}
