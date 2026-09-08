import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { UsbSerial, type UsbSerialDevice } from '@/native/usbSerialPlugin'
import { callPagerManually } from '@/features/pager/callPager'
import { buildPagerFrame, bytesToHex, PAGER_TEMPLATE_PRESETS } from '@/features/pager/pagerProtocol'
import type { PagerConfig } from '@/types/domain'

const isNative = Capacitor.isNativePlatform()

export function PagerSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canManage = roleHasPermission(currentUser.role, 'settings.manage')
  const settings = useLiveQuery(() => getSettings(), [])

  const [form, setForm] = useState<PagerConfig | null>(null)
  const [devices, setDevices] = useState<UsbSerialDevice[]>([])
  const [testNumber, setTestNumber] = useState(1)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) setForm(settings.pagerConfig)
  }, [settings])

  if (!canManage) return <p className="text-sm text-ink-400">Anda tidak memiliki izin mengelola pengaturan.</p>
  if (!form) return null

  const set = <K extends keyof PagerConfig>(key: K, value: PagerConfig[K]) => setForm({ ...form, [key]: value })
  const enabled = form.connectionType === 'usb-serial'

  let framePreview = ''
  try {
    if (form.commandTemplateHex.trim()) {
      framePreview = bytesToHex(buildPagerFrame(form.commandTemplateHex, testNumber || 1))
    }
  } catch (e) {
    framePreview = `⚠ ${e instanceof Error ? e.message : String(e)}`
  }

  async function scanDevices() {
    setMsg(null)
    try {
      setDevices((await UsbSerial.listDevices()).devices)
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  async function save() {
    if (!form) return
    await updateSettings({ pagerConfig: form })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function runTest() {
    setMsg(null)
    if (!form) return
    try {
      await updateSettings({ pagerConfig: form }) // pakai setelan terbaru
      await callPagerManually(testNumber)
      setMsg({ kind: 'ok', text: `Perintah panggil pager #${testNumber} terkirim.` })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink-50">Pager Restoran (Retekess)</h2>
        <p className="mt-1 text-xs text-ink-500">
          Base station Retekess dicolok ke tablet lewat USB-OTG (langsung, atau via adapter USB-to-RS232 FTDI/CP2102/CH340/PL2303).
          Nomor antrean pesanan dipakai sebagai nomor pager.
        </p>
      </div>

      {!isNative && (
        <p className="rounded-lg bg-ink-800 p-3 text-xs text-ink-400">
          Integrasi pager USB hanya berfungsi pada aplikasi Android (APK), bukan di web/PWA.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => set('connectionType', e.target.checked ? 'usb-serial' : 'none')}
        />
        Aktifkan pager Retekess di perangkat ini
      </label>

      {enabled && (
        <>
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input type="checkbox" checked={form.autoCallOnReady} onChange={(e) => set('autoCallOnReady', e.target.checked)} />
            Panggil otomatis saat semua item pesanan berstatus <span className="font-semibold">Siap</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Perangkat USB</span>
            <div className="flex gap-2">
              <select
                className="input-field"
                value={form.usbDeviceId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null
                  const label = devices.find((d) => d.deviceId === id)?.name ?? null
                  setForm({ ...form, usbDeviceId: id, usbDeviceLabel: label })
                }}
              >
                <option value="">Otomatis (perangkat serial pertama)</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.name}
                  </option>
                ))}
                {form.usbDeviceId != null && !devices.some((d) => d.deviceId === form.usbDeviceId) && (
                  <option value={form.usbDeviceId}>{form.usbDeviceLabel ?? `Device ${form.usbDeviceId}`} (tak terdeteksi)</option>
                )}
              </select>
              <button type="button" className="btn-secondary !min-h-0 !px-3 text-xs" onClick={() => void scanDevices()} disabled={!isNative}>
                Pindai
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Preset frame</span>
            <select
              className="input-field"
              value={PAGER_TEMPLATE_PRESETS.find((p) => p.templateHex === form.commandTemplateHex)?.id ?? 'custom'}
              onChange={(e) => {
                const preset = PAGER_TEMPLATE_PRESETS.find((p) => p.id === e.target.value)
                if (preset && preset.id !== 'custom') setForm({ ...form, commandTemplateHex: preset.templateHex, baudRate: preset.baudRate })
              }}
            >
              {PAGER_TEMPLATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-500">
              {PAGER_TEMPLATE_PRESETS.find((p) => p.templateHex === form.commandTemplateHex)?.note ??
                'Isi manual dari dokumen protokol RS-232 model Retekess Anda (minta ke support@retekess.com).'}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Template frame (hex + token {'{nnn}'} / {'{b}'})</span>
            <input
              className="input-field font-mono"
              placeholder="mis. 02{nnn}03"
              value={form.commandTemplateHex}
              onChange={(e) => set('commandTemplateHex', e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">Baud rate</span>
              <select className="input-field" value={form.baudRate} onChange={(e) => set('baudRate', Number(e.target.value))}>
                {[2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">Nomor pager maks.</span>
              <input
                type="number"
                min={1}
                max={999}
                className="input-field"
                value={form.maxPagerNumber}
                onChange={(e) => set('maxPagerNumber', Math.max(1, Number(e.target.value)))}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Jeda antar byte (ms) — biasanya 0</span>
            <input
              type="number"
              min={0}
              max={200}
              className="input-field"
              value={form.interCharDelayMs}
              onChange={(e) => set('interCharDelayMs', Math.max(0, Number(e.target.value)))}
            />
          </label>

          <div className="rounded-xl border border-ink-800 p-3">
            <span className="mb-2 block text-sm text-ink-300">Tes panggil</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                className="input-field !w-24"
                value={testNumber}
                onChange={(e) => setTestNumber(Math.max(1, Number(e.target.value)))}
              />
              <button type="button" className="btn-secondary !min-h-0 !px-4 text-sm" onClick={() => void runTest()} disabled={!isNative}>
                Bunyikan pager
              </button>
            </div>
            <p className="mt-2 font-mono text-xs text-ink-400">
              Frame: {framePreview || '—'}
            </p>
          </div>
        </>
      )}

      {msg && <p className={`text-sm ${msg.kind === 'ok' ? 'text-sage-500' : 'text-red-400'}`}>{msg.text}</p>}

      <button className="btn-primary" onClick={() => void save()}>
        Simpan
      </button>
      {saved && <p className="text-sm text-sage-500">Tersimpan</p>}
    </div>
  )
}
