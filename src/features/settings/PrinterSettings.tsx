import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listCategories } from '@/db/repositories/categories'
import {
  deletePrinter,
  listPrintRoutes,
  listPrinters,
  savePrinter,
  setPrintRoute,
  stationForCategory,
} from '@/db/repositories/printers'
import { enqueuePrintJob, processPrintQueue } from '@/db/repositories/printQueue'
import { buildSampleReceiptData } from '@/features/printing/receiptData'
import { EscPosPrinter, type BluetoothPrinterDevice } from '@/native/escPosPrinterPlugin'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { Icon } from '@/components/ui/Icon'
import type { Printer, PrinterStation, ReceiptPaperSize } from '@/types/domain'
import { PRINTER_STATIONS } from '@/types/domain'

const isNative = Capacitor.isNativePlatform()
const STATION_LABELS: Record<PrinterStation, string> = { cashier: 'Kasir', kitchen: 'Kitchen', bar: 'Bar' }

export function PrinterSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canManage = roleHasPermission(currentUser.role, 'printer.manage')
  const printers = useLiveQuery(() => listPrinters(), []) ?? []
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const routes = useLiveQuery(() => listPrintRoutes(), []) ?? []
  const [tab, setTab] = useState<'printers' | 'routing'>('printers')
  const [editing, setEditing] = useState<Printer | 'new' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const actor = { userId: currentUser.id, userName: currentUser.name }

  async function handleTest(printer: Printer) {
    setMsg(null)
    const data = buildSampleReceiptData((await db.settings.get('singleton'))!)
    await enqueuePrintJob({
      kind: 'receipt',
      station: printer.station,
      payload: { ...data, cafeName: `TEST — ${printer.name}` },
      title: `Test print — ${printer.name}`,
      idempotencyKey: `test_${printer.id}_${Date.now()}`,
      requestedBy: currentUser.id,
      requestedByName: currentUser.name,
    })
    await processPrintQueue()
    setMsg(`Test print dikirim ke "${printer.name}". Cek Antrean Cetak bila tak keluar.`)
  }

  if (!canManage) {
    return <p className="text-sm text-ink-400">Anda tidak memiliki izin mengelola printer.</p>
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex gap-2">
        {(['printers', 'routing'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`btn !min-h-0 !px-4 !py-2 text-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'printers' ? 'Printer' : 'Routing Kategori'}
          </button>
        ))}
      </div>

      {!isNative && (
        <p className="text-xs text-ink-500">
          Printer Bluetooth/WiFi hanya berfungsi pada aplikasi Android (APK). Di PWA/browser, cetak lewat dialog sistem.
        </p>
      )}
      {msg && <p className="text-sm text-sage-500">{msg}</p>}

      {tab === 'printers' && (
        <>
          <button className="btn-primary" onClick={() => setEditing('new')}>
            + Tambah Printer
          </button>
          <div className="space-y-2">
            {printers.map((p) => (
              <div key={p.id} className={`card p-4 ${p.active ? '' : 'opacity-50'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-ink-50">
                      {p.name} <span className="text-xs font-normal text-ink-400">· {STATION_LABELS[p.station]}</span>
                    </p>
                    <p className="text-xs text-ink-500">
                      {p.connectionType === 'network'
                        ? `LAN ${p.networkHost}:${p.networkPort}`
                        : p.connectionType === 'bluetooth'
                          ? `Bluetooth ${p.bluetoothName ?? p.bluetoothAddress ?? '—'}`
                          : 'Browser/Sistem'}
                      {' · '}
                      {p.paperSize}
                      {p.active ? '' : ' · nonaktif'}
                    </p>
                  </div>
                  <div className="flex flex-none gap-2">
                    <button className="btn-secondary !min-h-0 !px-3 !py-1 text-xs" onClick={() => void handleTest(p)}>
                      Test
                    </button>
                    <button className="btn-secondary !min-h-0 !px-3 !py-1 text-xs" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {printers.length === 0 && <p className="text-sm text-ink-500">Belum ada printer.</p>}
          </div>
        </>
      )}

      {tab === 'routing' && (
        <div className="space-y-2">
          <RouteRow
            label="Default (kategori tanpa aturan khusus)"
            station={routes.find((r) => r.categoryId === null)?.station ?? 'kitchen'}
            onChange={(s) => void setPrintRoute(null, s)}
          />
          {categories.map((c) => (
            <RouteRowLive key={c.id} categoryId={c.id} label={c.name} onChange={(s) => void setPrintRoute(c.id, s)} />
          ))}
          <p className="text-xs text-ink-500">Contoh: "Makanan" → Kitchen, "Kopi" &amp; "Non-Kopi" → Bar, sisanya default.</p>
        </div>
      )}

      {editing && (
        <PrinterFormModal
          printer={editing === 'new' ? null : editing}
          allPrinters={printers}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await savePrinter(data, actor)
            setEditing(null)
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await deletePrinter((editing as Printer).id, actor)
                  setEditing(null)
                }
          }
        />
      )}
    </div>
  )
}

function RouteRowLive({ categoryId, label, onChange }: { categoryId: string; label: string; onChange: (s: PrinterStation) => void }) {
  const station = useLiveQuery(() => stationForCategory(categoryId), [categoryId]) ?? 'kitchen'
  return <RouteRow label={label} station={station} onChange={onChange} />
}

function RouteRow({ label, station, onChange }: { label: string; station: PrinterStation; onChange: (s: PrinterStation) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-ink-800 px-4 py-2 text-sm">
      <span className="text-ink-200">{label}</span>
      <select className="input-field !w-28 !py-1" value={station} onChange={(e) => onChange(e.target.value as PrinterStation)}>
        {PRINTER_STATIONS.map((s) => (
          <option key={s} value={s}>
            {STATION_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  )
}

function PrinterFormModal({
  printer,
  allPrinters,
  onClose,
  onSave,
  onDelete,
}: {
  printer: Printer | null
  allPrinters: Printer[]
  onClose: () => void
  onSave: (data: Omit<Printer, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [name, setName] = useState(printer?.name ?? '')
  const [station, setStation] = useState<PrinterStation>(printer?.station ?? 'kitchen')
  const [connectionType, setConnectionType] = useState<Printer['connectionType']>(printer?.connectionType ?? (isNative ? 'network' : 'browser'))
  const [host, setHost] = useState(printer?.networkHost ?? '')
  const [port, setPort] = useState(printer?.networkPort ?? 9100)
  const [btAddress, setBtAddress] = useState(printer?.bluetoothAddress ?? '')
  const [btName, setBtName] = useState(printer?.bluetoothName ?? '')
  const [paperSize, setPaperSize] = useState<ReceiptPaperSize>(printer?.paperSize ?? '58mm')
  const [active, setActive] = useState(printer?.active ?? true)
  const [fallbackPrinterId, setFallback] = useState<string | null>(printer?.fallbackPrinterId ?? null)
  const [paired, setPaired] = useState<BluetoothPrinterDevice[]>([])

  async function scanBt() {
    try {
      setPaired((await EscPosPrinter.listPairedDevices()).devices)
    } catch {
      /* abaikan */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{printer ? 'Edit Printer' : 'Printer Baru'}</h2>
        <input className="input-field mb-3" placeholder="Nama printer" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mb-3 block text-sm text-ink-300">
          Station
          <select className="input-field mt-1" value={station} onChange={(e) => setStation(e.target.value as PrinterStation)}>
            {PRINTER_STATIONS.map((s) => (
              <option key={s} value={s}>
                {STATION_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3 block text-sm text-ink-300">
          Koneksi
          <select className="input-field mt-1" value={connectionType} onChange={(e) => setConnectionType(e.target.value as Printer['connectionType'])}>
            <option value="network">WiFi / LAN</option>
            <option value="bluetooth" disabled={!isNative}>
              Bluetooth
            </option>
            <option value="browser">Browser / Sistem</option>
          </select>
        </label>

        {connectionType === 'network' && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <input className="input-field col-span-2" placeholder="192.168.1.50" value={host} onChange={(e) => setHost(e.target.value)} />
            <input type="number" className="input-field" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </div>
        )}
        {connectionType === 'bluetooth' && (
          <div className="mb-3">
            <button type="button" className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => void scanBt()}>
              Cari Perangkat
            </button>
            <div className="mt-1 space-y-1">
              {paired.map((d) => (
                <button
                  key={d.address}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${btAddress === d.address ? 'bg-brew-600 text-white' : 'bg-ink-800 text-ink-200'}`}
                  onClick={() => {
                    setBtAddress(d.address)
                    setBtName(d.name)
                  }}
                >
                  {d.name} ({d.address})
                </button>
              ))}
            </div>
            {btName && <p className="mt-1 text-xs text-ink-400">Terpilih: {btName}</p>}
          </div>
        )}

        <div className="mb-3 flex gap-2">
          {(['58mm', '80mm'] as ReceiptPaperSize[]).map((s) => (
            <button key={s} className={`btn flex-1 ${paperSize === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPaperSize(s)}>
              {s}
            </button>
          ))}
        </div>

        <label className="mb-2 block text-sm text-ink-300">
          Printer cadangan (bila gagal)
          <select
            className="input-field mt-1"
            value={fallbackPrinterId ?? ''}
            onChange={(e) => setFallback(e.target.value || null)}
          >
            <option value="">— tidak ada —</option>
            {allPrinters.filter((p) => p.id !== printer?.id).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif
        </label>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          {onDelete && (
            <button className="btn-danger !px-3" onClick={() => void onDelete()}>
              <Icon name="close" size={16} />
            </button>
          )}
          <button
            className="btn-primary flex-[2]"
            disabled={!name.trim()}
            onClick={() =>
              void onSave({
                id: printer?.id,
                name: name.trim(),
                station,
                connectionType,
                bluetoothAddress: connectionType === 'bluetooth' ? btAddress || null : null,
                bluetoothName: connectionType === 'bluetooth' ? btName || null : null,
                networkHost: connectionType === 'network' ? host || null : null,
                networkPort: connectionType === 'network' ? port : null,
                paperSize,
                active,
                fallbackPrinterId,
              })
            }
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
