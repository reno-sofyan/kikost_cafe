import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listCategories } from '@/db/repositories/categories'
import { listProducts } from '@/db/repositories/products'
import {
  deleteKol,
  deleteKolPayout,
  deletePromo,
  kolCommissionLedger,
  listKols,
  listPromos,
  promoUsageCounts,
  recordKolPayout,
  saveKol,
  saveLoyaltySettings,
  savePromo,
  type KolCommission,
} from '@/db/repositories/promos'
import { buildSalesReport } from '@/db/repositories/reports'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { formatDateTime, startOfJakartaDay } from '@/lib/datetime'
import { DEFAULT_LOYALTY, loyaltySettingsOf } from '@/lib/loyalty'
import { describePromo, isPromoActiveAt, PROMO_DAY_LABELS } from '@/lib/promos'
import { Modal } from '@/components/ui/Modal'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Kol, LoyaltySettings, Promo } from '@/types/domain'

type Tab = 'promo' | 'kol' | 'member'
const TAB_LABELS: Record<Tab, string> = { promo: 'Promo & Voucher', kol: 'KOL / Influencer', member: 'Member & Poin' }

/** Promo otomatis, voucher, KOL, dan program member — pengelolaan untuk kafe & restoran. */
export function PromoScreen() {
  const [tab, setTab] = useState<Tab>('promo')
  const settings = useLiveQuery(() => getSettings(), [])
  const features = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  const tabs = (Object.keys(TAB_LABELS) as Tab[]).filter((t) => (t === 'member' ? features.loyalty : features.promos))

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Promo & Member</h1>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`btn btn-compact !px-4 text-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'promo' && <PromoTab />}
      {tab === 'kol' && <KolTab />}
      {tab === 'member' && <MemberTab />}
    </div>
  )
}

function useActor() {
  const user = useSessionStore((s) => s.currentUser)!
  return { userId: user.id, userName: user.name }
}

// ---------------------------------------------------------------- Promo & voucher

function PromoTab() {
  const actor = useActor()
  const promos = useLiveQuery(() => listPromos(), []) ?? []
  const kols = useLiveQuery(() => listKols(), []) ?? []
  const usage = useLiveQuery(() => promoUsageCounts(), [])
  const [editing, setEditing] = useState<Promo | 'new' | 'new-voucher' | null>(null)
  const { confirm, dialog } = useConfirmDialog()
  const now = Date.now()

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-ink-300">
          Promo otomatis terpasang sendiri di kasir saat syaratnya terpenuhi (bila beberapa cocok, dipakai yang potongannya terbesar). Voucher hanya terpasang
          bila kasir memasukkan kodenya, dan boleh digabung dengan satu promo otomatis.
        </p>
        <button className="btn-secondary" onClick={() => setEditing('new-voucher')}>
          + Voucher
        </button>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          + Promo Otomatis
        </button>
      </div>

      {promos.length === 0 ? (
        <p className="card p-6 text-center text-ink-400">Belum ada promo. Buat promo happy hour atau voucher pertama Anda.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {promos.map((p) => {
            const kol = kols.find((k) => k.id === p.kolId)
            const running = isPromoActiveAt(p, now, 'dine_in') || isPromoActiveAt(p, now, 'takeaway') || isPromoActiveAt(p, now, 'delivery')
            const used = usage?.get(p.id) ?? 0
            return (
              <div key={p.id} className={`card p-4 ${p.active ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-50">{p.name}</p>
                    <p className="mt-0.5 text-sm text-ink-300">{describePromo(p, formatRupiah)}</p>
                  </div>
                  <span
                    className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${
                      !p.active ? 'bg-ink-700 text-ink-200' : running ? 'bg-success-600/15 text-success-400' : 'bg-yellow-900/25 text-yellow-400'
                    }`}
                  >
                    {!p.active ? 'Nonaktif' : running ? 'Sedang berlaku' : 'Di luar jadwal'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-300">
                  {p.voucherCode ? (
                    <span className="rounded bg-brand-600/15 px-2 py-0.5 font-mono font-semibold tracking-wider text-brand-400">{p.voucherCode}</span>
                  ) : (
                    <span className="rounded bg-ink-800 px-2 py-0.5 font-semibold text-ink-200">Otomatis</span>
                  )}
                  {kol && <span>KOL: {kol.name}</span>}
                  <span>
                    Terpakai {formatNumber(used)}×{p.usageLimit ? ` dari ${formatNumber(p.usageLimit)}` : ''}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn-secondary btn-compact !px-3 text-sm" onClick={() => setEditing(p)}>
                    Ubah
                  </button>
                  <button
                    className="btn-ghost btn-compact !px-3 text-sm"
                    onClick={() => void savePromo({ ...p, active: !p.active }, actor).catch((e) => toast.error(e instanceof Error ? e.message : 'Gagal'))}
                  >
                    {p.active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    className="btn-ghost btn-compact ml-auto !px-3 text-sm !text-red-400"
                    onClick={async () => {
                      if (!(await confirm({ title: `Hapus "${p.name}"?`, description: 'Transaksi lama yang memakainya tetap tercatat di laporan.', confirmLabel: 'Hapus', tone: 'danger' }))) return
                      await deletePromo(p.id, actor)
                    }}
                  >
                    Hapus
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <PromoFormModal initial={typeof editing === 'string' ? null : editing} asVoucher={editing === 'new-voucher'} kols={kols} onClose={() => setEditing(null)} />}
      {dialog}
    </div>
  )
}

function PromoFormModal({ initial, asVoucher, kols, onClose, presetKolId }: { initial: Promo | null; asVoucher: boolean; kols: Kol[]; onClose: () => void; presetKolId?: string }) {
  const actor = useActor()
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const products = useLiveQuery(() => listProducts(), []) ?? []
  const isVoucher = asVoucher || !!initial?.voucherCode
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<Promo['kind']>(initial?.kind ?? 'percent')
  const [value, setValue] = useState(initial?.value ?? 10)
  const [scope, setScope] = useState<Promo['scope']>(initial?.scope ?? 'order')
  const [targetIds, setTargetIds] = useState<string[]>(initial?.targetIds ?? [])
  const [minSubtotal, setMinSubtotal] = useState(initial?.minSubtotal ?? 0)
  const [maxDiscount, setMaxDiscount] = useState(initial?.maxDiscount ?? 0)
  const [days, setDays] = useState<number[]>(initial?.days ?? [])
  const [startTime, setStartTime] = useState(initial?.startTime ?? '')
  const [endTime, setEndTime] = useState(initial?.endTime ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [voucherCode, setVoucherCode] = useState(initial?.voucherCode ?? '')
  const [usageLimit, setUsageLimit] = useState(initial?.usageLimit ?? 0)
  const [kolId, setKolId] = useState(initial?.kolId ?? presetKolId ?? '')
  const [buyQty, setBuyQty] = useState(initial?.buyQty ?? 2)
  const [getQty, setGetQty] = useState(initial?.getQty ?? 1)
  const [memberOnly, setMemberOnly] = useState(!!initial?.memberOnly)
  const [oncePerCustomer, setOncePerCustomer] = useState(!!initial?.oncePerCustomer)
  const [birthday, setBirthday] = useState<'' | 'day' | 'month'>(initial?.birthday ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const targets = scope === 'category' ? categories.map((c) => ({ id: c.id, name: c.name })) : products.map((p) => ({ id: p.id, name: p.name }))
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function handleSave() {
    setBusy(true)
    setError(null)
    try {
      await savePromo(
        {
          id: initial?.id,
          name,
          active: initial?.active ?? true,
          kind,
          value,
          scope,
          targetIds: scope === 'order' ? [] : targetIds,
          minSubtotal: minSubtotal || undefined,
          maxDiscount: kind === 'percent' && maxDiscount ? maxDiscount : undefined,
          days: days.length && days.length < 7 ? days : undefined,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          orderTypes: initial?.orderTypes,
          voucherCode: isVoucher ? voucherCode : null,
          usageLimit: isVoucher ? usageLimit : null,
          kolId: isVoucher ? kolId || null : null,
          buyQty: kind === 'bxgy' ? buyQty : undefined,
          getQty: kind === 'bxgy' ? getQty : undefined,
          memberOnly,
          oncePerCustomer,
          birthday: birthday || null,
        },
        actor,
      )
      toast.success(`${isVoucher ? 'Voucher' : 'Promo'} disimpan.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-4 text-lg font-bold text-ink-50">
        {initial ? 'Ubah' : 'Buat'} {isVoucher ? 'Voucher' : 'Promo Otomatis'}
      </h2>

      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Nama {isVoucher ? 'Voucher' : 'Promo'}</span>
        <input className="input-field" autoFocus maxLength={60} placeholder={isVoucher ? 'mis. "Voucher Pembukaan"' : 'mis. "Happy Hour Kopi"'} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {isVoucher && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Kode Voucher</span>
            <input className="input-field font-mono uppercase tracking-wider" maxLength={20} placeholder="HEMAT20" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase().replace(/\s/g, ''))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Kuota Pemakaian (0 = bebas)</span>
            <input type="number" min={0} className="input-field" value={usageLimit} onChange={(e) => setUsageLimit(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          {kols.length > 0 && (
            <label className="col-span-2 block">
              <span className="mb-1 block text-sm text-ink-300">Milik KOL (opsional)</span>
              <select className="input-field" value={kolId} onChange={(e) => setKolId(e.target.value)}>
                <option value="">— Bukan voucher KOL —</option>
                {kols.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} {k.handle ? `(${k.handle})` : ''} — komisi {k.commissionPercent}%
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-sm text-ink-300">Jenis Potongan</span>
          <div className="flex gap-2">
            {(['percent', 'amount', 'bxgy'] as const).map((k) => (
              <button key={k} className={`btn btn-compact flex-1 !px-1 text-sm ${kind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(k)}>
                {k === 'percent' ? 'Persen' : k === 'amount' ? 'Rupiah' : 'Beli X Gratis Y'}
              </button>
            ))}
          </div>
        </div>
        {kind === 'bxgy' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">Beli</span>
              <input type="number" min={1} className="input-field" aria-label="Jumlah beli" value={buyQty} onChange={(e) => setBuyQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">Gratis</span>
              <input type="number" min={1} className="input-field" aria-label="Jumlah gratis" value={getQty} onChange={(e) => setGetQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </label>
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Nilai Potongan</span>
            {kind === 'percent' ? (
              <input type="number" min={0} max={100} className="input-field" value={value} onChange={(e) => setValue(Number(e.target.value) || 0)} />
            ) : (
              <input className="input-field" inputMode="numeric" value={formatRupiah(value)} onChange={(e) => setValue(parseRupiahInput(e.target.value))} />
            )}
          </label>
        )}
        {kind === 'bxgy' && (
          <p className="col-span-2 -mt-1 text-xs text-ink-400">
            Tiap {buyQty + getQty} item yang cocok dalam satu pesanan, {getQty} item termurah gratis. Pilih kategori/produknya di "Berlaku Untuk".
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Minimal Belanja (opsional)</span>
          <input className="input-field" inputMode="numeric" value={minSubtotal ? formatRupiah(minSubtotal) : ''} placeholder="Tanpa minimal" onChange={(e) => setMinSubtotal(parseRupiahInput(e.target.value))} />
        </label>
        {kind === 'percent' && (
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Maksimal Potongan (opsional)</span>
            <input className="input-field" inputMode="numeric" value={maxDiscount ? formatRupiah(maxDiscount) : ''} placeholder="Tanpa batas" onChange={(e) => setMaxDiscount(parseRupiahInput(e.target.value))} />
          </label>
        )}
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-sm text-ink-300">Berlaku Untuk</span>
        <div className="mb-2 flex gap-2">
          {(['order', 'category', 'product'] as const).map((s) => (
            <button
              key={s}
              className={`btn btn-compact flex-1 text-sm ${scope === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setScope(s)
                setTargetIds([])
              }}
            >
              {s === 'order' ? 'Semua Item' : s === 'category' ? 'Kategori' : 'Produk'}
            </button>
          ))}
        </div>
        {scope !== 'order' && (
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-xl border border-ink-800 p-2">
            {targets.map((t) => (
              <button key={t.id} className={`btn btn-compact !px-3 text-sm ${targetIds.includes(t.id) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTargetIds((l) => toggle(l, t.id))}>
                {t.name}
              </button>
            ))}
            {targets.length === 0 && <span className="text-sm text-ink-500">Belum ada data.</span>}
          </div>
        )}
      </div>

      <div className="mb-3 rounded-xl border border-ink-800 p-3">
        <span className="mb-2 block text-sm text-ink-300">Syarat Member</span>
        <label className="mb-2 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={memberOnly || oncePerCustomer || !!birthday} disabled={oncePerCustomer || !!birthday} onChange={(e) => setMemberOnly(e.target.checked)} />
          Khusus member (pesanan harus dikaitkan dengan pelanggan terdaftar)
        </label>
        <label className="mb-2 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={oncePerCustomer} onChange={(e) => setOncePerCustomer(e.target.checked)} />
          Satu kali per member
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <span className="flex-none">Promo ulang tahun</span>
          <select className="input-field !py-1.5" aria-label="Promo ulang tahun" value={birthday} onChange={(e) => setBirthday(e.target.value as '' | 'day' | 'month')}>
            <option value="">Bukan promo ulang tahun</option>
            <option value="day">Hanya di hari ulang tahun member</option>
            <option value="month">Sepanjang bulan ulang tahun member</option>
          </select>
        </label>
        {birthday && <p className="mt-2 text-xs text-ink-400">Terpasang otomatis untuk member yang tanggal lahirnya terisi, satu kali per tahun.</p>}
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-sm text-ink-300">Hari Berlaku (kosong = setiap hari)</span>
        <div className="flex gap-1.5">
          {PROMO_DAY_LABELS.map((label, day) => (
            <button key={day} className={`btn btn-compact flex-1 !px-0 text-sm ${days.includes(day) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays((l) => toggle(l, day))}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Jam Mulai (WIB)</span>
          <input type="time" className="input-field" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Jam Selesai (WIB)</span>
          <input type="time" className="input-field" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Tanggal Mulai (opsional)</span>
          <input type="date" className="input-field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Tanggal Selesai (opsional)</span>
          <input type="date" className="input-field" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy} onClick={() => void handleSave()}>
          {busy ? 'Menyimpan...' : `Simpan ${isVoucher ? 'Voucher' : 'Promo'}`}
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- KOL

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

// ---------------------------------------------------------------- Member & poin

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
