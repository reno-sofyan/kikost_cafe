import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listMarketingSales, saveMarketingSales } from '@/db/repositories/customers'
import { buildMarketingBillReport } from '@/db/repositories/marketingBills'
import { SalesAvatar } from '@/features/customers/SalesAvatar'
import { formatNumber, formatRupiah } from '@/lib/currency'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { toast } from '@/state/toastStore'
import { Modal } from '@/components/ui/Modal'
import type { Customer } from '@/types/domain'

/**
 * Pelanggan → Tim Marketing: daftar sales yang dipilih kasir saat membuat pesanan
 * "Marketing" (jamuan klien yang ditagihkan ke kantor). Disimpan di tabel pelanggan
 * supaya ikut sinkron ke semua tablet, tapi tak tampil sebagai pelanggan/member.
 */
export function MarketingTeamPanel({ canManage }: { canManage: boolean }) {
  // Yang aktif dulu; nonaktif di belakang (tetap ada untuk riwayat tagihannya).
  const salesList = (useLiveQuery(() => listMarketingSales(), []) ?? []).sort(
    (a, b) => Number(!a.marketingSales?.active) - Number(!b.marketingSales?.active),
  )
  // Ringkasan sepanjang waktu per sales (kunjungan & tagihan yang belum dibayar kantor).
  const summary = useLiveQuery(async () => {
    const report = await buildMarketingBillReport({ from: 0, to: Date.now() + 86_400_000 })
    return new Map(report.bySales.map((s) => [s.salesId, s]))
  }, [])
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-bold text-ink-50">Tim Marketing</h2>
        {canManage && (
          <button className="btn-primary" onClick={() => setEditing('new')}>
            + Sales Baru
          </button>
        )}
      </div>
      <p className="mb-5 text-sm text-ink-400">
        Sales yang bisa dipilih kasir lewat Pesanan Baru → Marketing. Tagihannya ditagihkan ke kantor dan tampil terpisah di Laporan → Tagihan Marketing.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {salesList.map((s) => {
          const stat = summary?.get(s.id)
          const profile = s.marketingSales!
          return (
            <button
              key={s.id}
              disabled={!canManage}
              onClick={() => setEditing(s)}
              className={`card flex items-center gap-3 p-4 text-left ${profile.active ? '' : 'opacity-60'} ${canManage ? 'hover:border-brand-600' : ''}`}
            >
              <SalesAvatar name={s.name} photo={profile.photoDataUrl} size={56} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink-50">
                  {s.name}
                  {!profile.active && <span className="ml-2 rounded-full bg-ink-700 px-2 py-0.5 text-xs font-medium text-ink-300">Nonaktif</span>}
                </span>
                <span className="block truncate text-sm text-ink-400">{[profile.division, s.phone].filter(Boolean).join(' • ') || '—'}</span>
                <span className="mt-1 block text-xs text-ink-300">
                  {formatNumber(stat?.count ?? 0)} kunjungan • {formatRupiah(stat?.total ?? 0)}
                  {stat?.outstanding ? <span className="text-red-400"> • belum dibayar {formatRupiah(stat.outstanding)}</span> : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {salesList.length === 0 && <p className="mt-8 text-center text-sm text-ink-500">Belum ada sales terdaftar.</p>}
      {editing && <SalesFormModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SalesFormModal({ initial, onClose }: { initial: Customer | null; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [division, setDivision] = useState(initial?.marketingSales?.division ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [photo, setPhoto] = useState<string | null>(initial?.marketingSales?.photoDataUrl ?? null)
  const [active, setActive] = useState(initial?.marketingSales?.active ?? true)
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    setBusy(true)
    try {
      await saveMarketingSales(initial?.id ?? null, { name, phone, note, division, photoDataUrl: photo, active })
      toast.success(initial ? 'Data sales diperbarui.' : 'Sales ditambahkan.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan sales')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Sales' : 'Sales Baru'}</h2>
      <div className="mb-4 flex items-center gap-4">
        <SalesAvatar name={name} photo={photo} size={72} />
        <div className="flex flex-col gap-2">
          <label className="btn-secondary btn-compact cursor-pointer !px-4 text-sm">
            {photo ? 'Ganti Foto' : 'Ambil / Pilih Foto'}
            <input
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              aria-label="Foto sales"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                // Foto kecil saja: ikut sinkron ke semua tablet bersama data sales.
                if (file) setPhoto(await readFileAsResizedDataUrl(file, 240, 0.8))
              }}
            />
          </label>
          {photo && (
            <button className="text-left text-xs font-semibold text-red-400" onClick={() => setPhoto(null)}>
              Hapus foto
            </button>
          )}
        </div>
      </div>
      <input className="input-field mb-3" placeholder="Nama sales" aria-label="Nama sales" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input-field mb-3" placeholder="Divisi / jabatan (opsional)" aria-label="Divisi" value={division} onChange={(e) => setDivision(e.target.value)} />
      <input className="input-field mb-3" placeholder="No. HP (opsional)" aria-label="No. HP sales" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <textarea className="input-field mb-3" placeholder="Catatan (opsional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="mb-4 flex items-center gap-2 text-sm text-ink-200">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Aktif (muncul di pilihan kasir)
      </label>
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !name.trim()} onClick={() => void handleSave()}>
          Simpan
        </button>
      </div>
    </Modal>
  )
}
