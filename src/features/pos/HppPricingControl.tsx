import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listKols } from '@/db/repositories/promos'
import { clearOrderHppPricing, previewHppPricing, setOrderHppPricing, type HppPricingInput } from '@/db/repositories/hppPricing'
import { HPP_PRICING_LABELS } from '@/lib/hppPricing'
import { formatRupiah } from '@/lib/currency'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Order } from '@/types/domain'

/**
 * Tombol "KOL" & "Compliment" di keranjang kasir (kafe). Memilihnya langsung menjadikan
 * pesanan berharga HPP — tanpa tombol konfirmasi & tanpa PIN. Compliment = satu ketukan
 * (penerima diambil dari catatan pesanan); KOL = ketuk nama KOL dari daftar menu KOL.
 */
export function HppPricingControl({ order }: { order: Order }) {
  const [pickKol, setPickKol] = useState(false)
  const user = useSessionStore((s) => s.currentUser)!
  const actor = { userId: user.id, userName: user.name }
  const pricing = order.hppPricing
  const paid = order.status !== 'open'

  async function apply(input: HppPricingInput) {
    try {
      await setOrderHppPricing(order.id, input, actor)
      const preview = await previewHppPricing(order.id)
      toast.success(
        `${HPP_PRICING_LABELS[input.kind]} — harga HPP ${formatRupiah(preview.hppTotal)}.` + (preview.missingHpp.length ? ` Belum ada HPP: ${preview.missingHpp.join(', ')}.` : ''),
      )
      setPickKol(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menerapkan harga HPP.')
    }
  }

  if (pricing) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-500/10 px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-semibold text-ink-50">
            {HPP_PRICING_LABELS[pricing.kind]} — {pricing.name}
          </span>
          <span className="block truncate text-xs text-ink-300">Harga HPP • oleh {pricing.approvedByName}</span>
        </span>
        {!paid && (
          <button
            className="flex-none text-xs font-semibold text-red-400"
            onClick={() =>
              void clearOrderHppPricing(order.id, actor)
                .then(() => toast.success('Kembali ke harga jual normal.'))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Gagal melepas.'))
            }
          >
            Lepas
          </button>
        )}
      </div>
    )
  }
  if (paid) return null
  const btn = 'flex min-h-[2.4rem] flex-1 items-center justify-center gap-2 rounded-full border-2 border-dashed border-accent-500/60 text-[0.85rem] font-medium text-ink-100 hover:bg-accent-500/5'
  return (
    <>
      <div className="flex gap-2">
        <button className={btn} onClick={() => setPickKol(true)}>
          <Icon name="megaphone" size={16} /> KOL
        </button>
        <button className={btn} onClick={() => void apply({ kind: 'compliment', kolId: null, name: '', reason: '' })}>
          <Icon name="star" size={16} /> Compliment
        </button>
      </div>
      {pickKol && <KolPicker onPick={(input) => void apply(input)} onClose={() => setPickKol(false)} />}
    </>
  )
}

/** Daftar KOL aktif — ketuk satu nama langsung menerapkan harga HPP. */
function KolPicker({ onPick, onClose }: { onPick: (input: HppPricingInput) => void; onClose: () => void }) {
  const kols = (useLiveQuery(() => listKols(), []) ?? []).filter((k) => k.active)
  const [other, setOther] = useState('')

  return (
    <Modal onClose={onClose} className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-2xl bg-ink-900 p-6">
      <h2 className="text-lg font-bold text-ink-50">Pilih KOL</h2>
      <p className="mb-3 text-sm text-ink-400">Pesanan langsung dihargai HPP.</p>
      <div className="mb-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {kols.map((k) => (
          <button key={k.id} className="card flex w-full items-center justify-between p-3 text-left hover:bg-ink-800" onClick={() => onPick({ kind: 'kol', kolId: k.id, name: '', reason: '' })}>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink-50">{k.name}</span>
              {(k.handle || k.platform) && <span className="block truncate text-xs text-ink-400">{[k.platform, k.handle].filter(Boolean).join(' • ')}</span>}
            </span>
            <Icon name="check" size={16} className="flex-none text-ink-400" />
          </button>
        ))}
        {kols.length === 0 && <p className="text-sm text-ink-400">Belum ada KOL terdaftar di menu KOL.</p>}
      </div>
      <div className="flex gap-2">
        <input
          className="input-field flex-1"
          maxLength={60}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && other.trim()) onPick({ kind: 'kol', kolId: null, name: other, reason: '' })
          }}
          placeholder="KOL lain (belum terdaftar)"
          aria-label="Nama KOL lain"
        />
        <button className="btn-secondary btn-compact !px-4" disabled={!other.trim()} onClick={() => onPick({ kind: 'kol', kolId: null, name: other, reason: '' })}>
          Pakai
        </button>
      </div>
    </Modal>
  )
}
