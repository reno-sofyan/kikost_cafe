import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listKols } from '@/db/repositories/promos'
import { clearOrderHppPricing, previewHppPricing, setOrderHppPricing } from '@/db/repositories/hppPricing'
import { HPP_PRICING_LABELS } from '@/lib/hppPricing'
import { formatRupiah } from '@/lib/currency'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { HppPricingKind, Order } from '@/types/domain'

const OTHER_KOL = '__lain__'

/**
 * Baris "KOL / Compliment" di keranjang kasir (kafe): menjadikan pesanan berharga HPP.
 * Tanpa PIN — kasir yang menerapkan, penerima & alasannya tercatat di Log Aktivitas.
 */
export function HppPricingControl({ order }: { order: Order }) {
  const [open, setOpen] = useState(false)
  const user = useSessionStore((s) => s.currentUser)!
  const pricing = order.hppPricing
  const paid = order.status !== 'open'

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
              void clearOrderHppPricing(order.id, { userId: user.id, userName: user.name })
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
  return (
    <>
      <button
        className="flex min-h-[2.4rem] w-full items-center justify-center gap-2 rounded-full border-2 border-dashed border-accent-500/60 text-[0.85rem] font-medium text-ink-100 hover:bg-accent-500/5"
        onClick={() => setOpen(true)}
      >
        <Icon name="megaphone" size={16} /> KOL / Compliment
      </button>
      {open && <HppPricingModal order={order} onClose={() => setOpen(false)} />}
    </>
  )
}

function HppPricingModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const user = useSessionStore((s) => s.currentUser)!
  const kols = (useLiveQuery(() => listKols(), []) ?? []).filter((k) => k.active)
  const preview = useLiveQuery(() => previewHppPricing(order.id), [order.id, order.subtotal])
  const [kind, setKind] = useState<HppPricingKind>('kol')
  const [kolId, setKolId] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherKol = kind === 'kol' && kolId === OTHER_KOL
  const valid = kind === 'kol' ? (kolId && kolId !== OTHER_KOL) || (otherKol && name.trim().length > 0) : name.trim().length > 0 && reason.trim().length >= 3

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      await setOrderHppPricing(order.id, { kind, kolId: kind === 'kol' && !otherKol ? kolId : null, name, reason }, { userId: user.id, userName: user.name })
      toast.success(`Pesanan dijadikan ${HPP_PRICING_LABELS[kind]} — harga HPP.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menerapkan harga HPP.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal onClose={onClose} className="w-full max-w-md rounded-2xl bg-ink-900 p-6">
        <h2 className="text-lg font-bold text-ink-50">KOL / Compliment</h2>
        <p className="mb-4 text-sm text-ink-400">Semua menu di pesanan ini dihargai HPP (harga pokok). Pajak, service charge, diskon & promo tidak berlaku. Tercatat atas nama Anda.</p>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {(['kol', 'compliment'] as const).map((k) => (
            <button key={k} className={`btn btn-compact text-sm ${kind === k ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {HPP_PRICING_LABELS[k]}
            </button>
          ))}
        </div>

        {kind === 'kol' ? (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm text-ink-300">KOL</span>
            <select className="input-field" value={kolId} onChange={(e) => setKolId(e.target.value)} aria-label="Pilih KOL">
              <option value="">Pilih KOL…</option>
              {kols.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                  {k.handle ? ` (${k.handle})` : ''}
                </option>
              ))}
              <option value={OTHER_KOL}>KOL lain (belum terdaftar)…</option>
            </select>
          </label>
        ) : null}
        {(kind === 'compliment' || otherKol) && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm text-ink-300">{kind === 'kol' ? 'Nama KOL' : 'Nama penerima'}</span>
            <input className="input-field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'kol' ? 'mis. @kulinerbogor' : 'mis. Pak RT, tamu owner'} aria-label={kind === 'kol' ? 'Nama KOL' : 'Nama penerima compliment'} />
          </label>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Alasan {kind === 'kol' ? '(opsional)' : ''}</span>
          <input className="input-field" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'kol' ? 'mis. review menu baru' : 'mis. tamu kehormatan, kompensasi pesanan lama'} aria-label="Alasan KOL/Compliment" />
        </label>

        {preview && (
          <div className="mb-3 rounded-xl bg-ink-800 p-3 text-sm">
            <div className="flex justify-between text-ink-300">
              <span>Harga jual normal</span>
              <span className="tabular-nums line-through">{formatRupiah(preview.normalTotal)}</span>
            </div>
            <div className="flex justify-between font-semibold text-ink-50">
              <span>Dibayar tamu (HPP)</span>
              <span className="tabular-nums">{formatRupiah(preview.hppTotal)}</span>
            </div>
            {preview.missingHpp.length > 0 && <p className="mt-2 text-xs text-yellow-400">Belum ada HPP (dihargai Rp0): {preview.missingHpp.join(', ')}. Isi HPP di menu Produk.</p>}
          </div>
        )}
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" disabled={!valid || busy} onClick={() => void apply()}>
            Terapkan Harga HPP
          </button>
        </div>
      </Modal>
    </>
  )
}
