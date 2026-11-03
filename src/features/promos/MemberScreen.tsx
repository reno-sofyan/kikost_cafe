import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { saveLoyaltySettings } from '@/db/repositories/promos'
import { getSettings } from '@/db/repositories/settings'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { DEFAULT_LOYALTY, loyaltySettingsOf } from '@/lib/loyalty'
import { toast } from '@/state/toastStore'
import type { LoyaltySettings } from '@/types/domain'
import { useActor } from '@/features/promos/useActor'

/** Program member: poin, tingkatan & pengaturan member. */
export function MemberScreen() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-5 text-xl font-bold text-ink-50">Member & Poin</h1>
      <MemberTab />
    </div>
  )
}

function MemberTab() {
  const actor = useActor()
  const settings = useLiveQuery(() => getSettings(), [])
  const [draft, setDraft] = useState<LoyaltySettings | null>(null)
  useEffect(() => {
    if (settings && !draft) setDraft(loyaltySettingsOf(settings))
  }, [settings, draft])
  if (!draft) return <p className="text-ink-500">Memuat...</p>

  const set = (patch: Partial<LoyaltySettings>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const setTier = (index: number, patch: Partial<LoyaltySettings['tiers'][number]>) => set({ tiers: draft.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
  const example = 100_000

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-semibold text-ink-50">Program Member Aktif</span>
            <span className="block text-sm text-ink-300">Pelanggan terdaftar mengumpulkan poin tiap transaksi lunas dan bisa menukarnya jadi potongan di kasir.</span>
          </span>
          <input type="checkbox" className="h-5 w-5 flex-none" aria-label="Program member aktif" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        </label>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-ink-50">Aturan Poin</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Belanja per 1 poin</span>
            <input className="input-field" inputMode="numeric" value={formatRupiah(draft.earnPerAmount)} onChange={(e) => set({ earnPerAmount: parseRupiahInput(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Nilai tukar 1 poin</span>
            <input className="input-field" inputMode="numeric" value={formatRupiah(draft.pointValue)} onChange={(e) => set({ pointValue: parseRupiahInput(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Minimal tukar (poin)</span>
            <input type="number" min={1} className="input-field" value={draft.minRedeem} onChange={(e) => set({ minRedeem: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </label>
        </div>
        <label className="mt-3 block max-w-xs">
          <span className="mb-1 block text-sm text-ink-300">Masa berlaku poin (bulan, 0 = tidak hangus)</span>
          <input type="number" min={0} className="input-field" aria-label="Masa berlaku poin" value={draft.expiryMonths ?? 0} onChange={(e) => set({ expiryMonths: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        </label>
        {(draft.expiryMonths ?? 0) > 0 && (
          <p className="mt-1 text-xs text-ink-400">Poin yang belum ditukar hangus {draft.expiryMonths} bulan setelah didapat; poin terlama dipakai lebih dulu. Berlaku juga untuk poin yang sudah ada.</p>
        )}
        {draft.earnPerAmount > 0 && (
          <p className="mt-3 text-sm text-ink-300">
            Contoh: belanja {formatRupiah(example)} = {formatNumber(Math.floor(example / draft.earnPerAmount))} poin, senilai{' '}
            {formatRupiah(Math.floor(example / draft.earnPerAmount) * draft.pointValue)} ({((draft.pointValue / draft.earnPerAmount) * 100).toFixed(1)}% kembali ke member).
          </p>
        )}
      </div>

      <div className="card p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-semibold text-ink-50">Saldo Member (Deposit)</span>
            <span className="block text-sm text-ink-300">
              Member mengisi saldo di muka (menu Pelanggan) lalu membayar pesanan dengan "Saldo Member". Uang isi saldo dicatat sebagai titipan, baru menjadi omzet saat dipakai.
            </span>
          </span>
          <input type="checkbox" className="h-5 w-5 flex-none" aria-label="Saldo member aktif" checked={!!draft.depositEnabled} onChange={(e) => set({ depositEnabled: e.target.checked })} />
        </label>
      </div>

      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-ink-50">Tingkatan Member</h2>
        <p className="mb-3 text-sm text-ink-300">Naik tingkat otomatis dari total belanja; tingkat lebih tinggi mendapat poin lebih banyak.</p>
        <div className="space-y-2">
          {draft.tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_6rem_auto] items-end gap-2">
              <label className="block">
                {i === 0 && <span className="mb-1 block text-xs text-ink-300">Nama</span>}
                <input className="input-field" aria-label={`Nama tingkatan ${i + 1}`} value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} />
              </label>
              <label className="block">
                {i === 0 && <span className="mb-1 block text-xs text-ink-300">Total belanja minimal</span>}
                <input className="input-field" inputMode="numeric" aria-label={`Belanja minimal tingkatan ${i + 1}`} disabled={i === 0} value={formatRupiah(t.minSpend)} onChange={(e) => setTier(i, { minSpend: parseRupiahInput(e.target.value) })} />
              </label>
              <label className="block">
                {i === 0 && <span className="mb-1 block text-xs text-ink-300">Pengali poin</span>}
                <input type="number" min={0} step={0.05} className="input-field" aria-label={`Pengali poin tingkatan ${i + 1}`} value={t.multiplier} onChange={(e) => setTier(i, { multiplier: Number(e.target.value) || 0 })} />
              </label>
              <button className="btn-ghost btn-compact !px-3 !text-red-400 disabled:opacity-30" disabled={i === 0 || draft.tiers.length <= 1} onClick={() => set({ tiers: draft.tiers.filter((_, x) => x !== i) })}>
                Hapus
              </button>
            </div>
          ))}
        </div>
        <button className="btn-secondary btn-compact mt-3 !px-3 text-sm" onClick={() => set({ tiers: [...draft.tiers, { name: '', minSpend: (draft.tiers[draft.tiers.length - 1]?.minSpend ?? 0) * 2 || 1_000_000, multiplier: 1 }] })}>
          + Tingkatan
        </button>
      </div>

      <div className="flex gap-3">
        <button className="btn-ghost" onClick={() => setDraft({ ...DEFAULT_LOYALTY, enabled: draft.enabled, depositEnabled: draft.depositEnabled })}>
          Kembalikan ke Bawaan
        </button>
        <button
          className="btn-primary"
          onClick={() =>
            void saveLoyaltySettings(draft, actor).then(
              () => toast.success('Pengaturan member disimpan.'),
              (e) => toast.error(e instanceof Error ? e.message : 'Gagal menyimpan'),
            )
          }
        >
          Simpan Pengaturan Member
        </button>
      </div>
    </div>
  )
}
