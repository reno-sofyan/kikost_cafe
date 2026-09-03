import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { createTable, issueQrToken, listTables, setQrActive, updateTable } from '@/db/repositories/tables'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { saveFile } from '@/lib/saveFile'
import { Icon } from '@/components/ui/Icon'
import type { CafeTable } from '@/types/domain'

function orderUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/order/${token}`
}

async function pngBlob(text: string): Promise<Blob> {
  const dataUrl = await QRCode.toDataURL(text, { width: 720, margin: 2, errorCorrectionLevel: 'M' })
  const res = await fetch(dataUrl)
  return res.blob()
}

export function TableQrSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canManage = roleHasPermission(currentUser.role, 'qr.manage')
  const actor = { userId: currentUser.id, userName: currentUser.name }

  const settings = useLiveQuery(() => getSettings(), [])
  const tables = useLiveQuery(() => listTables(), []) ?? []

  const [baseUrl, setBaseUrl] = useState('')
  const [savedBase, setSavedBase] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings) setBaseUrl(settings.qrOrderBaseUrl)
  }, [settings])

  if (!settings) return null

  if (!canManage) {
    return <p className="text-sm text-ink-400">Anda tidak memiliki izin mengelola Meja &amp; QR.</p>
  }

  async function guard(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal')
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-100">URL Halaman Pesan-Mandiri</h3>
        <p className="text-xs text-ink-500">
          Alamat publik tempat pelanggan membuka menu. QR berisi <code>{'<url>'}/order/{'<token>'}</code>. Ubah hanya
          jika domain berubah.
        </p>
        <div className="flex gap-2">
          <input className="input-field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://pos.kikost.com" />
          <button
            className="btn-primary !min-h-0 !px-4"
            onClick={() =>
              void guard(async () => {
                await updateSettings({ qrOrderBaseUrl: baseUrl.trim().replace(/\/+$/, '') })
                setSavedBase(true)
                setTimeout(() => setSavedBase(false), 2000)
              })
            }
          >
            Simpan
          </button>
        </div>
        {savedBase && <p className="text-xs text-sage-500">Tersimpan</p>}
      </section>

      {error && <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-100">Meja / Titik QR</h3>
        <div className="flex gap-2">
          <input
            className="input-field"
            placeholder="Nama meja / area (mis. Meja 1, Pojok, Bar)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="btn-secondary !min-h-0 !px-4"
            disabled={!newName.trim()}
            onClick={() =>
              void guard(async () => {
                await createTable({ name: newName.trim(), area: '', capacity: 2 })
                setNewName('')
              })
            }
          >
            Tambah
          </button>
        </div>

        {tables.length === 0 && <p className="text-sm text-ink-500">Belum ada meja. Tambahkan minimal satu untuk memakai QR.</p>}

        <div className="space-y-3">
          {tables.map((t) => (
            <TableRow key={t.id} table={t} baseUrl={settings.qrOrderBaseUrl} actor={actor} onError={setError} />
          ))}
        </div>
      </section>
    </div>
  )
}

function TableRow({
  table,
  baseUrl,
  actor,
  onError,
}: {
  table: CafeTable
  baseUrl: string
  actor: { userId: string; userName: string }
  onError: (m: string) => void
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(table.name)
  const url = useMemo(() => (table.qrToken ? orderUrl(baseUrl, table.qrToken) : null), [baseUrl, table.qrToken])

  useEffect(() => {
    let alive = true
    if (url) {
      void QRCode.toDataURL(url, { width: 240, margin: 1 }).then((d) => {
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
    try {
      await fn()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Gagal')
    }
  }

  return (
    <div className="flex gap-4 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
      <div className="flex h-28 w-28 flex-none items-center justify-center rounded-lg bg-white">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={`QR ${table.name}`} className="h-full w-full object-contain p-1" />
        ) : (
          <span className="px-2 text-center text-[10px] text-ink-500">QR belum dibuat</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {renaming ? (
            <>
              <input className="input-field !min-h-0 !py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
              <button
                className="btn-primary !min-h-0 !px-2 !py-1 text-xs"
                onClick={() =>
                  void guard(async () => {
                    await updateTable(table.id, { name: name.trim() || table.name })
                    setRenaming(false)
                  })
                }
              >
                Simpan
              </button>
            </>
          ) : (
            <>
              <span className="font-semibold text-ink-50">{table.name}</span>
              <button className="text-ink-500 hover:text-ink-300" onClick={() => setRenaming(true)} title="Ubah nama">
                <Icon name="edit" size={14} />
              </button>
              {table.qrToken && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    table.qrActive ? 'bg-sage-600/20 text-sage-400' : 'bg-red-900/30 text-red-400'
                  }`}
                >
                  {table.qrActive ? 'QR aktif' : 'QR nonaktif'}
                </span>
              )}
            </>
          )}
        </div>

        {url && <p className="truncate text-xs text-ink-500">{url}</p>}

        <div className="mt-auto flex flex-wrap gap-2">
          <button
            className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs"
            onClick={() => void guard(() => issueQrToken(table.id, actor))}
          >
            {table.qrToken ? 'Ganti Token' : 'Buat QR'}
          </button>
          {table.qrToken && (
            <>
              <button
                className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs"
                onClick={() =>
                  void guard(async () => {
                    const blob = await pngBlob(orderUrl(baseUrl, table.qrToken!))
                    await saveFile(`qr-${table.name.replace(/\s+/g, '-').toLowerCase()}.png`, blob)
                  })
                }
              >
                <Icon name="image" size={13} className="mr-1 inline" />
                Unduh PNG
              </button>
              <button
                className="btn-ghost !min-h-0 !px-3 !py-1.5 text-xs"
                onClick={() => void guard(() => setQrActive(table.id, !table.qrActive, actor))}
              >
                {table.qrActive ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
