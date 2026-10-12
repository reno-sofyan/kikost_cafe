import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { tableLongStayMinutesOf } from '@/db/repositories/serviceInsights'
import { featuresForBusinessType } from '@/lib/businessType'
import { CUSTOMER_DISPLAY_PATH } from '@/lib/customerDisplay'
import { kitchenTargetMinutesOf } from '@/lib/kitchenSpeed'
import { waPhone } from '@/lib/whatsapp'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'

const isNativeApp = () => !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

/** Pengaturan → Operasional: batas waktu dapur & meja, WhatsApp pemilik, layar pelanggan. */
export function OperationsSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const settings = useLiveQuery(() => getSettings(), [])
  const [kitchenTarget, setKitchenTarget] = useState(15)
  const [longStay, setLongStay] = useState(90)
  const [ownerWhatsapp, setOwnerWhatsapp] = useState('')

  useEffect(() => {
    if (!settings) return
    setKitchenTarget(kitchenTargetMinutesOf(settings))
    setLongStay(tableLongStayMinutesOf(settings))
    setOwnerWhatsapp(settings.ownerWhatsapp ?? '')
  }, [settings])

  if (!settings) return null
  const features = featuresForBusinessType(settings.businessType)
  const phoneInvalid = ownerWhatsapp.trim() !== '' && !waPhone(ownerWhatsapp)

  async function save() {
    await updateSettings({
      kitchenTargetMinutes: Math.max(0, Math.round(kitchenTarget) || 0),
      tableLongStayMinutes: Math.max(0, Math.round(longStay) || 0),
      ownerWhatsapp: ownerWhatsapp.trim(),
    })
    await recordAuditLog({
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'settings.operations',
      entityType: 'settings',
      entityId: 'singleton',
      details: `Pengaturan operasional diubah: batas dapur ${kitchenTarget} mnt, batas lama meja ${longStay} mnt.`,
    })
    toast.success('Pengaturan operasional disimpan.')
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="card space-y-4 p-6">
        <h2 className="text-lg font-bold text-ink-50">Batas Waktu Layanan</h2>
        {features.kitchen && (
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Batas penyiapan dapur / bar (menit)</span>
            <input type="number" min={0} max={240} className="input-field" aria-label="Batas penyiapan dapur" value={kitchenTarget} onChange={(e) => setKitchenTarget(Number(e.target.value))} />
            <span className="mt-1 block text-xs text-ink-400">Pesanan yang menunggu lebih lama dari ini ditandai terlambat di layar Dapur dan di menu. Isi 0 untuk mematikan.</span>
          </label>
        )}
        {features.tables && (
          <label className="block">
            <span className="mb-1 block text-sm text-ink-300">Batas lama tamu di meja (menit)</span>
            <input type="number" min={0} max={720} className="input-field" aria-label="Batas lama tamu di meja" value={longStay} onChange={(e) => setLongStay(Number(e.target.value))} />
            <span className="mt-1 block text-xs text-ink-400">Meja yang terisi lebih lama dari ini ditandai di denah. Isi 0 untuk mematikan.</span>
          </label>
        )}
      </div>

      <div className="card space-y-3 p-6">
        <h2 className="text-lg font-bold text-ink-50">Ringkasan untuk Pemilik</h2>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Nomor WhatsApp pemilik</span>
          <input className="input-field" inputMode="tel" placeholder="08xxxxxxxxxx" aria-label="Nomor WhatsApp pemilik" value={ownerWhatsapp} onChange={(e) => setOwnerWhatsapp(e.target.value)} />
          <span className={`mt-1 block text-xs ${phoneInvalid ? 'text-red-400' : 'text-ink-400'}`}>
            {phoneInvalid ? 'Nomor tidak valid.' : 'Saat shift ditutup, kasir bisa mengirim ringkasan omzet & selisih kas ke nomor ini.'}
          </span>
        </label>
      </div>

      <button className="btn-primary w-full" disabled={phoneInvalid} onClick={() => void save()}>
        Simpan
      </button>

      <div className="card space-y-3 p-6">
        <h2 className="text-lg font-bold text-ink-50">Layar Pelanggan</h2>
        <p className="text-sm text-ink-300">
          Tampilan kedua yang menghadap tamu: daftar pesanan, total, dan QRIS saat membayar. Buka di jendela kedua pada perangkat ini, lalu geser ke monitor yang menghadap tamu.
        </p>
        {isNativeApp() ? (
          <p className="rounded-xl bg-ink-800 px-3 py-2 text-sm text-ink-300">
            Aplikasi Android tidak bisa membuka jendela kedua. Layar pelanggan tersedia bila kasir dijalankan di browser komputer (Chrome/Edge) dengan monitor kedua.
          </p>
        ) : (
          <button className="btn-secondary w-full" onClick={() => window.open(CUSTOMER_DISPLAY_PATH, 'kione-layar-pelanggan', 'popup,width=1024,height=768')}>
            Buka Layar Pelanggan
          </button>
        )}
      </div>
    </div>
  )
}
