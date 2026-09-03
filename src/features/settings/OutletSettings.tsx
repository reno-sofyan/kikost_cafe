import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '@/db/repositories/settings'
import { getActiveOutlet, listOutlets, saveOutlet, setActiveOutlet } from '@/db/repositories/outlets'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import type { Outlet } from '@/types/domain'

export function OutletSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canManage = roleHasPermission(currentUser.role, 'settings.manage')
  const actor = { userId: currentUser.id, userName: currentUser.name }

  const outlets = useLiveQuery(() => listOutlets(), [])
  const activeId = useLiveQuery(async () => (await getSettings()).activeOutletId, [])
  const [editing, setEditing] = useState<Outlet | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pastikan minimal satu outlet ada.
  useEffect(() => {
    if (outlets && outlets.length === 0) void getActiveOutlet()
  }, [outlets])

  if (!canManage) return <p className="text-sm text-ink-400">Butuh izin kelola pengaturan.</p>
  if (!outlets) return null

  async function guard(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      setEditing(null)
      setCreating(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal.')
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-xs text-ink-500">
        Kafe satu lokasi memakai satu outlet. Struktur ini memisahkan laporan &amp; stok bila nanti ada cabang.
        Pesanan &amp; shift baru otomatis ditandai outlet aktif.
      </p>
      {error && <p className="rounded-lg bg-red-900/20 p-2 text-sm text-red-400">{error}</p>}

      {outlets.map((o) => (
        <div key={o.id} className="card flex items-center justify-between p-4">
          <div>
            <p className="font-semibold text-ink-50">
              {o.name}
              {o.id === activeId && <span className="ml-2 rounded-full bg-sage-600/20 px-2 py-0.5 text-xs text-sage-400">aktif</span>}
              {!o.active && <span className="ml-2 text-xs text-red-400">nonaktif</span>}
            </p>
            <p className="text-sm text-ink-400">{o.address || '—'} · {o.timezone}</p>
          </div>
          <div className="flex gap-2">
            {o.id !== activeId && o.active && (
              <button className="btn-ghost !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => void guard(() => setActiveOutlet(o.id))}>
                Jadikan aktif
              </button>
            )}
            <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => setEditing(o)}>
              Ubah
            </button>
          </div>
        </div>
      ))}

      <button className="btn-secondary" onClick={() => setCreating(true)}>+ Outlet</button>

      {(editing || creating) && (
        <OutletForm
          outlet={editing}
          onCancel={() => {
            setEditing(null)
            setCreating(false)
          }}
          onSave={(data) => void guard(() => saveOutlet({ ...data, id: editing?.id }, actor))}
        />
      )}
    </div>
  )
}

function OutletForm({
  outlet,
  onCancel,
  onSave,
}: {
  outlet: Outlet | null
  onCancel: () => void
  onSave: (d: { name: string; address: string; phone: string; timezone: string; active: boolean }) => void
}) {
  const [name, setName] = useState(outlet?.name ?? '')
  const [address, setAddress] = useState(outlet?.address ?? '')
  const [phone, setPhone] = useState(outlet?.phone ?? '')
  const [active, setActive] = useState(outlet?.active ?? true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-bold text-ink-50">{outlet ? 'Ubah Outlet' : 'Outlet Baru'}</h3>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Nama</span>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Alamat</span>
          <textarea className="input-field" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Telepon</span>
          <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif
        </label>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onCancel}>Batal</button>
          <button
            className="btn-primary flex-[2]"
            disabled={!name.trim()}
            onClick={() => onSave({ name, address, phone, timezone: outlet?.timezone ?? 'Asia/Jakarta', active })}
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
