import { HPP_PRICING_LABELS } from '@/lib/hppPricing'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { deleteKol, deleteKolPayout, kolCommissionLedger, listKols, listPromos, recordKolPayout, saveKol, type KolCommission } from '@/db/repositories/promos'
import { buildSalesReport } from '@/db/repositories/reports'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { formatDateTime, startOfJakartaDay } from '@/lib/datetime'
import { Modal } from '@/components/ui/Modal'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { toast } from '@/state/toastStore'
import type { Kol } from '@/types/domain'
import { PromoFormModal } from '@/features/promos/PromoScreen'
import { useActor } from '@/features/promos/useActor'

/** KOL / influencer rekanan: kode voucher per orang, kinerja penjualan & komisi. */
export function KolScreen() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-5 text-xl font-bold text-ink-50">KOL / Influencer</h1>
      <KolTab />
    </div>
  )
}

function KolTab() {
  const actor = useActor()
  const kols = useLiveQuery(() => listKols(), []) ?? []
  const promos = useLiveQuery(() => listPromos(), []) ?? []
  // Kinerja 30 hari terakhir dari transaksi yang memakai voucher tiap KOL.
  const report = useLiveQuery(() => buildSalesReport({ from: startOfJakartaDay(29), to: Date.now() }), [])
  const [editing, setEditing] = useState<Kol | 'new' | null>(null)
  const [voucherFor, setVoucherFor] = useState<Kol | null>(null)
  const [payoutFor, setPayoutFor] = useState<Kol | null>(null)
  const ledger = useLiveQuery(() => kolCommissionLedger(), [])
  const { confirm, dialog } = useConfirmDialog()

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-ink-300">
          Daftarkan KOL/influencer rekanan dan beri tiap orang kode voucher sendiri. Setiap transaksi yang memakai kodenya tercatat sebagai penjualan KOL itu,
          lengkap dengan estimasi komisinya. Untuk kunjungan gratis (endorse), buat voucher 100% berkuota 1.
        </p>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          + KOL Baru
        </button>
      </div>

      {kols.length === 0 ? (
        <p className="card p-6 text-center text-ink-400">Belum ada KOL terdaftar.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-ink-800 text-left text-ink-300">
              <tr>
                <th className="px-4 py-2">KOL</th>
                <th className="px-4 py-2">Kode Voucher</th>
                <th className="px-4 py-2 text-right">Transaksi (30 hr)</th>
                <th className="px-4 py-2 text-right">Omzet</th>
                <th className="px-4 py-2 text-right">Komisi (30 hr)</th>
                <th className="px-4 py-2 text-right">Komisi Terutang</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {kols.map((k) => {
                const perf = report?.byKol.find((r) => r.kolId === k.id)
                const codes = promos.filter((p) => p.kolId === k.id)
                const commission = ledger?.get(k.id)
                return (
                  <tr key={k.id} className={`border-t border-ink-800 ${k.active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-50">{k.name}</p>
                      <p className="text-xs text-ink-300">
                        {[k.platform, k.handle].filter(Boolean).join(' • ') || '—'} • komisi {k.commissionPercent}%
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {codes.map((p) => (
                          <span key={p.id} className={`rounded px-2 py-0.5 font-mono text-xs font-semibold tracking-wider ${p.active ? 'bg-brand-600/15 text-brand-400' : 'bg-ink-800 text-ink-300 line-through'}`}>
                            {p.voucherCode}
                          </span>
                        ))}
                        <button className="text-xs text-brand-400 underline-offset-2 hover:underline" onClick={() => setVoucherFor(k)}>
                          + kode
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-100">{formatNumber(perf?.transactionCount ?? 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-100">{formatRupiah(perf?.revenue ?? 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-100">{formatRupiah(perf?.commission ?? 0)}</td>
                    <td className="px-4 py-3 text-right">
                      <p className={`font-semibold tabular-nums ${(commission?.outstanding ?? 0) > 0 ? 'text-yellow-400' : 'text-ink-50'}`}>{formatRupiah(commission?.outstanding ?? 0)}</p>
                      <p className="text-xs text-ink-300">dibayar {formatRupiah(commission?.paid ?? 0)}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button className="btn-primary btn-compact mr-1 !px-3 text-sm" onClick={() => setPayoutFor(k)}>
                        Bayar Komisi
                      </button>
                      <button className="btn-secondary btn-compact !px-3 text-sm" onClick={() => setEditing(k)}>
                        Ubah
                      </button>
                      <button
                        className="btn-ghost btn-compact !px-3 text-sm !text-red-400"
                        onClick={async () => {
                          if (!(await confirm({ title: `Hapus KOL ${k.name}?`, description: 'Kode vouchernya dinonaktifkan. Laporan transaksi lama tetap tersimpan.', confirmLabel: 'Hapus', tone: 'danger' }))) return
                          await deleteKol(k.id, actor)
                        }}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {report && report.hppPricing.count > 0 && (
        <div className="mt-6">
          <h2 className="mb-1 font-semibold text-ink-100">Pesanan KOL & Compliment harga HPP • 30 hari</h2>
          <p className="mb-3 text-sm text-ink-400">
            Dari kasir (tombol KOL / Compliment). Dibayar = harga HPP yang dibayar tamu; nilai diberikan = selisih dengan harga jual normal.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-ink-800 text-left text-ink-300">
                <tr>
                  <th className="px-4 py-2">Penerima</th>
                  <th className="px-4 py-2 text-right">Pesanan</th>
                  <th className="px-4 py-2 text-right">Dibayar (HPP)</th>
                  <th className="px-4 py-2 text-right">Harga jual normal</th>
                  <th className="px-4 py-2 text-right">Nilai diberikan</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...report.hppPricing.byKol.map((r) => ({ key: r.kolId ?? r.name, label: `KOL • ${r.name}${r.kolId ? '' : ' (belum terdaftar)'}`, ...r })),
                  ...report.hppPricing.byKind.filter((r) => r.kind !== 'kol').map((r) => ({ key: r.kind, label: `${HPP_PRICING_LABELS[r.kind]} (semua)`, ...r })),
                ].map((r) => (
                  <tr key={r.key} className="border-t border-ink-800">
                    <td className="px-4 py-2 text-ink-50">{r.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatNumber(r.count)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatRupiah(r.paid)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-300">{formatRupiah(r.normalValue)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-50">{formatRupiah(r.normalValue - r.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <KolFormModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {voucherFor && <PromoFormModal initial={null} asVoucher kols={kols} presetKolId={voucherFor.id} onClose={() => setVoucherFor(null)} />}
      {payoutFor && <KolPayoutModal kol={payoutFor} commission={ledger?.get(payoutFor.id)} onClose={() => setPayoutFor(null)} />}
      {dialog}
    </div>
  )
}

function KolPayoutModal({ kol, commission, onClose }: { kol: Kol; commission: KolCommission | undefined; onClose: () => void }) {
  const actor = useActor()
  const outstanding = Math.max(0, commission?.outstanding ?? 0)
  const [amount, setAmount] = useState(outstanding)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { confirm, dialog } = useConfirmDialog()

  async function handleSave() {
    setError(null)
    try {
      await recordKolPayout({ kolId: kol.id, amount, note }, actor)
      toast.success(`Pembayaran komisi ${kol.name} dicatat.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencatat.')
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-3 text-lg font-bold text-ink-50">Komisi • {kol.name}</h2>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-ink-800 p-2">
          <p className="text-xs text-ink-300">Total komisi</p>
          <p className="font-semibold tabular-nums text-ink-50">{formatRupiah(commission?.earned ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-ink-800 p-2">
          <p className="text-xs text-ink-300">Sudah dibayar</p>
          <p className="font-semibold tabular-nums text-ink-50">{formatRupiah(commission?.paid ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-ink-800 p-2">
          <p className="text-xs text-ink-300">Terutang</p>
          <p className="font-semibold tabular-nums text-yellow-400">{formatRupiah(commission?.outstanding ?? 0)}</p>
        </div>
      </div>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Nominal Dibayar</span>
        <input className="input-field" inputMode="numeric" aria-label="Nominal dibayar" value={formatRupiah(amount)} onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Catatan (opsional)</span>
        <input className="input-field" placeholder='mis. "Transfer BCA, komisi Oktober"' value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="mb-3 text-xs text-ink-400">Ini hanya catatan pelunasan. Bila dibayar tunai dari laci kasir, catat juga sebagai Kas Keluar di shift.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="mb-4 flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Tutup
        </button>
        <button className="btn-primary flex-[2]" disabled={!(amount > 0)} onClick={() => void handleSave()}>
          Catat Pembayaran
        </button>
      </div>
      {(commission?.payouts.length ?? 0) > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-ink-100">Riwayat Pembayaran</h3>
          <div className="space-y-2">
            {commission!.payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-ink-800 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold tabular-nums text-ink-50">{formatRupiah(p.amount)}</p>
                  <p className="truncate text-xs text-ink-300">
                    {formatDateTime(p.createdAt)} • {p.userName}
                    {p.note ? ` • ${p.note}` : ''}
                  </p>
                </div>
                <button
                  className="flex-none text-xs font-semibold text-red-400"
                  onClick={async () => {
                    if (!(await confirm({ title: 'Hapus catatan pembayaran ini?', description: 'Komisi terutang akan bertambah kembali.', confirmLabel: 'Hapus', tone: 'danger' }))) return
                    await deleteKolPayout(p.id, actor)
                  }}
                >
                  Hapus
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {dialog}
    </Modal>
  )
}

function KolFormModal({ initial, onClose }: { initial: Kol | null; onClose: () => void }) {
  const actor = useActor()
  const [name, setName] = useState(initial?.name ?? '')
  const [platform, setPlatform] = useState(initial?.platform ?? 'Instagram')
  const [handle, setHandle] = useState(initial?.handle ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [commissionPercent, setCommissionPercent] = useState(initial?.commissionPercent ?? 5)
  const [note, setNote] = useState(initial?.note ?? '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    try {
      await saveKol({ id: initial?.id, name, platform: platform.trim(), handle: handle.trim(), phone: phone.trim(), commissionPercent, active, note: note.trim() }, actor)
      toast.success('KOL disimpan.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    }
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-md rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Ubah KOL' : 'KOL Baru'}</h2>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Nama KOL</span>
        <input className="input-field" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Platform</span>
          <input className="input-field" list="kol-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} />
          <datalist id="kol-platforms">
            {['Instagram', 'TikTok', 'YouTube', 'X / Twitter', 'Facebook'].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Nama Akun</span>
          <input className="input-field" placeholder="@akun" value={handle} onChange={(e) => setHandle(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">No. HP (opsional)</span>
          <input className="input-field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Komisi (%)</span>
          <input type="number" min={0} max={100} step={0.5} className="input-field" value={commissionPercent} onChange={(e) => setCommissionPercent(Number(e.target.value) || 0)} />
        </label>
      </div>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Catatan Kerja Sama (opsional)</span>
        <input className="input-field" placeholder='mis. "2 konten/bulan, kontrak s.d. Des"' value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="mb-4 flex items-center gap-2 text-sm text-ink-200">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Kerja sama aktif
      </label>
      <p className="mb-3 text-xs text-ink-400">Komisi dihitung dari penjualan bersih (setelah diskon, sebelum pajak & service charge) tiap transaksi yang memakai kode vouchernya.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" onClick={() => void handleSave()}>
          Simpan KOL
        </button>
      </div>
    </Modal>
  )
}
