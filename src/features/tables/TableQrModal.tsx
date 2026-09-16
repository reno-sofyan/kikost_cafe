import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { getSettings } from '@/db/repositories/settings'
import { deleteTableIfUnused, issueQrToken, listTables, setQrActive, updateTable } from '@/db/repositories/tables'
import { useSessionStore } from '@/state/sessionStore'
import { saveFile } from '@/lib/saveFile'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import type { CafeTable } from '@/types/domain'

function orderUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/order/${token}`
}

async function pngBlob(text: string): Promise<Blob> {
  const dataUrl = await QRCode.toDataURL(text, { width: 720, margin: 2, errorCorrectionLevel: 'M' })
  const res = await fetch(dataUrl)
  return res.blob()
}

interface Props {
  table: CafeTable
  onClose: () => void
}

/** QR meja siap tempel — dipakai dari Denah Meja (langsung setelah meja dibuat)
 * dan dari Pengaturan → Meja & QR (kelola/regenerasi). Satu sumber render QR
 * supaya perilakunya konsisten di kedua tempat. */
export function TableQrModal({ table: initial, onClose }: Props) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const actor = { userId: currentUser.id, userName: currentUser.name }
  const settings = useLiveQuery(() => getSettings(), [])
  const table = useLiveQuery(() => listTables(), [])?.find((t) => t.id === initial.id) ?? initial
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(table.name)
  const [area, setArea] = useState(table.area)
  const [capacity, setCapacity] = useState(table.capacity)
  const url = useMemo(
    () => (settings && table.qrToken ? orderUrl(settings.qrOrderBaseUrl, table.qrToken) : null),
    [settings, table.qrToken],
  )

  useEffect(() => {
    let alive = true
    if (url) {
      void QRCode.toDataURL(url, { width: 280, margin: 1 }).then((d) => {
        if (alive) setQrDataUrl(d)
      })
    } else {
      setQrDataUrl(null)
    }
    return () => {
      alive = false
    }
  }, [url])

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-ink-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink-50">QR — {table.name}</h2>
        <div className="flex items-center gap-1">
          {!editing && (
            <button
              className="rounded-full p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              title="Ubah nama/area/kapasitas"
              onClick={() => {
                setName(table.name)
                setArea(table.area)
                setCapacity(table.capacity)
                setEditing(true)
              }}
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          <button className="btn-ghost btn-compact !px-3" aria-label="Tutup" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      {editing && (
        <div className="mb-4 space-y-3 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Nama Meja</span>
            <input className="input-field !min-h-0 !py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Area</span>
            <input className="input-field !min-h-0 !py-2 text-sm" value={area} onChange={(e) => setArea(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Kapasitas</span>
            <input
              type="number"
              min={1}
              className="input-field !min-h-0 !py-2 text-sm"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value) || 1)}
            />
          </label>
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1 !min-h-[2.75rem] !py-1.5 text-sm"
              disabled={busy || !name.trim()}
              onClick={() =>
                void guard(async () => {
                  await updateTable(table.id, { name: name.trim(), area: area.trim(), capacity: Math.max(1, capacity) })
                  setEditing(false)
                })
              }
            >
              Simpan
            </button>
            <button className="btn-ghost flex-1 !min-h-[2.75rem] !py-1.5 text-sm" onClick={() => setEditing(false)}>
              Batal
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <div className="flex h-52 w-52 items-center justify-center rounded-xl bg-white p-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR ${table.name}`} className="h-full w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-xs text-ink-500">Belum ada QR — buat di bawah</span>
          )}
        </div>

        {table.qrToken && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              table.qrActive ? 'bg-sage-600/20 text-sage-400' : 'bg-red-900/30 text-red-400'
            }`}
          >
            {table.qrActive ? 'QR aktif' : 'QR nonaktif'}
          </span>
        )}
        {url && <p className="max-w-full truncate text-xs text-ink-500">{url}</p>}
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => void guard(() => issueQrToken(table.id, actor))}
        >
          {table.qrToken ? 'Ganti Token QR' : 'Buat QR'}
        </button>
        {table.qrToken && (
          <>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                void guard(async () => {
                  const blob = await pngBlob(orderUrl(settings!.qrOrderBaseUrl, table.qrToken!))
                  await saveFile(`qr-${table.name.replace(/\s+/g, '-').toLowerCase()}.png`, blob)
                })
              }
            >
              <Icon name="image" size={14} className="mr-1.5 inline" />
              Unduh PNG untuk Ditempel
            </button>
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => void guard(() => setQrActive(table.id, !table.qrActive, actor))}
            >
              {table.qrActive ? 'Nonaktifkan QR' : 'Aktifkan QR'}
            </button>
          </>
        )}
        <button
          className="btn-ghost !text-red-400"
          disabled={busy}
          onClick={() =>
            void guard(async () => {
              const ok = await confirm({
                title: `Hapus ${table.name}?`,
                description: 'Hanya bisa dihapus bila meja ini belum pernah dipakai untuk pesanan apa pun.',
                confirmLabel: 'Ya, Hapus',
                tone: 'danger',
              })
              if (!ok) return
              await deleteTableIfUnused(table.id)
              onClose()
            })
          }
        >
          Hapus Meja
        </button>
      </div>
      {confirmDialog}
    </Modal>
  )
}
