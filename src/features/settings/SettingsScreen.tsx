import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { UserManager } from '@/features/settings/UserManager'
import { BackupManager } from '@/features/settings/BackupManager'
import { PrinterSettings } from '@/features/settings/PrinterSettings'
import { SyncPanel } from '@/features/settings/SyncPanel'
import { AuditLogPanel } from '@/features/settings/AuditLogPanel'
import type { ReceiptPaperSize } from '@/types/domain'

type Tab = 'profil' | 'pajak' | 'qris' | 'printer' | 'pengguna' | 'sinkronisasi' | 'backup' | 'audit'

const TAB_KEYS: Tab[] = ['profil', 'pajak', 'qris', 'printer', 'pengguna', 'sinkronisasi', 'backup', 'audit']

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function SettingsScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const [searchParams] = useSearchParams()
  const initialTab = TAB_KEYS.find((k) => k === searchParams.get('tab')) ?? 'profil'
  const [tab, setTab] = useState<Tab>(initialTab)
  const settings = useLiveQuery(() => getSettings(), [])

  const tabs: { key: Tab; label: string; visible: boolean }[] = [
    { key: 'profil', label: 'Profil Kafe', visible: true },
    { key: 'pajak', label: 'Pajak & Struk', visible: true },
    { key: 'qris', label: 'QRIS', visible: true },
    { key: 'printer', label: 'Printer', visible: true },
    { key: 'pengguna', label: 'Pengguna', visible: roleHasPermission(currentUser.role, 'users.manage') },
    { key: 'sinkronisasi', label: 'Sinkronisasi', visible: true },
    { key: 'backup', label: 'Backup', visible: roleHasPermission(currentUser.role, 'users.manage') },
    { key: 'audit', label: 'Log Aktivitas', visible: roleHasPermission(currentUser.role, 'users.manage') },
  ]

  if (!settings) return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-ink-800 px-6 py-4">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Pengaturan</h1>
        {tabs
          .filter((t) => t.visible)
          .map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`btn !min-h-0 !px-4 !py-2 text-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}>
              {t.label}
            </button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'profil' && <ProfileForm />}
        {tab === 'pajak' && <FiscalForm />}
        {tab === 'qris' && <QrisForm />}
        {tab === 'printer' && <PrinterSettings />}
        {tab === 'pengguna' && <UserManager />}
        {tab === 'sinkronisasi' && <SyncPanel />}
        {tab === 'backup' && <BackupManager />}
        {tab === 'audit' && <AuditLogPanel />}
      </div>
    </div>
  )
}

function ProfileForm() {
  const settings = useLiveQuery(() => getSettings(), [])
  const [cafeName, setCafeName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setCafeName(settings.cafeName)
    setAddress(settings.address)
    setPhone(settings.phone)
    setLogoDataUrl(settings.logoDataUrl)
  }, [settings])

  if (!settings) return null

  return (
    <div className="max-w-md space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Nama Kafe</span>
        <input className="input-field" value={cafeName} onChange={(e) => setCafeName(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Alamat</span>
        <textarea className="input-field" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Telepon</span>
        <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Logo</span>
        <input
          type="file"
          accept="image/*"
          className="text-sm text-ink-300"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) setLogoDataUrl(await readFileAsDataUrl(file))
          }}
        />
        {logoDataUrl && <img src={logoDataUrl} alt="Logo" className="mt-2 h-16 w-16 rounded-full object-cover" />}
      </label>
      <button
        className="btn-primary"
        onClick={async () => {
          await updateSettings({ cafeName, address, phone, logoDataUrl })
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        }}
      >
        Simpan
      </button>
      {saved && <p className="text-sm text-sage-500">Tersimpan</p>}
    </div>
  )
}

function FiscalForm() {
  const settings = useLiveQuery(() => getSettings(), [])
  const [taxPercent, setTaxPercent] = useState(0)
  const [serviceChargePercent, setServiceChargePercent] = useState(0)
  const [roundingIncrement, setRoundingIncrement] = useState(100)
  const [transactionPrefix, setTransactionPrefix] = useState('')
  const [receiptPaperSize, setReceiptPaperSize] = useState<ReceiptPaperSize>('58mm')
  const [receiptFooterNote, setReceiptFooterNote] = useState('')
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [blindClose, setBlindClose] = useState(false)
  const [cashVarianceTolerance, setCashVarianceTolerance] = useState(5000)
  const [allowPartialPayment, setAllowPartialPayment] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setTaxPercent(settings.taxPercent)
    setServiceChargePercent(settings.serviceChargePercent)
    setRoundingIncrement(settings.roundingIncrement)
    setTransactionPrefix(settings.transactionPrefix)
    setReceiptPaperSize(settings.receiptPaperSize)
    setReceiptFooterNote(settings.receiptFooterNote)
    setAutoLockMinutes(settings.autoLockMinutes)
    setBlindClose(settings.blindClose)
    setCashVarianceTolerance(settings.cashVarianceTolerance)
    setAllowPartialPayment(settings.allowPartialPayment)
  }, [settings])

  if (!settings) return null

  return (
    <div className="max-w-md space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Pajak (%)</span>
        <input type="number" min={0} max={100} className="input-field" value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value))} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Service Charge (%)</span>
        <input
          type="number"
          min={0}
          max={100}
          className="input-field"
          value={serviceChargePercent}
          onChange={(e) => setServiceChargePercent(Number(e.target.value))}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Pembulatan Total (Rp)</span>
        <select className="input-field" value={roundingIncrement} onChange={(e) => setRoundingIncrement(Number(e.target.value))}>
          <option value={1}>Tanpa pembulatan</option>
          <option value={100}>Ke Rp 100 terdekat</option>
          <option value={500}>Ke Rp 500 terdekat</option>
          <option value={1000}>Ke Rp 1.000 terdekat</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Awalan Nomor Transaksi</span>
        <input className="input-field" value={transactionPrefix} onChange={(e) => setTransactionPrefix(e.target.value.toUpperCase())} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Ukuran Kertas Struk</span>
        <div className="flex gap-2">
          {(['58mm', '80mm'] as ReceiptPaperSize[]).map((size) => (
            <button
              key={size}
              className={`btn flex-1 ${receiptPaperSize === size ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReceiptPaperSize(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Catatan Kaki Struk</span>
        <input className="input-field" value={receiptFooterNote} onChange={(e) => setReceiptFooterNote(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Kunci Layar Otomatis Setelah (menit, 0 = nonaktif)</span>
        <input type="number" min={0} className="input-field" value={autoLockMinutes} onChange={(e) => setAutoLockMinutes(Number(e.target.value))} />
      </label>

      <div className="rounded-xl border border-ink-800 p-3">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={blindClose} onChange={(e) => setBlindClose(e.target.checked)} />
          Blind close — sembunyikan kas seharusnya sampai kasir mengisi hitungan fisik
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm text-ink-300">Toleransi Selisih Kas (Rp)</span>
          <input
            type="number"
            min={0}
            className="input-field"
            value={cashVarianceTolerance}
            onChange={(e) => setCashVarianceTolerance(Number(e.target.value))}
          />
          <span className="mt-1 block text-xs text-ink-500">Selisih di atas nilai ini butuh persetujuan supervisor saat tutup shift.</span>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={allowPartialPayment} onChange={(e) => setAllowPartialPayment(e.target.checked)} />
          Izinkan pembayaran sebagian (bayar DP / cicil; pesanan tetap terbuka sampai lunas)
        </label>
      </div>

      <button
        className="btn-primary"
        onClick={async () => {
          await updateSettings({
            taxPercent,
            serviceChargePercent,
            roundingIncrement,
            transactionPrefix,
            receiptPaperSize,
            receiptFooterNote,
            autoLockMinutes,
            blindClose,
            cashVarianceTolerance,
            allowPartialPayment,
          })
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        }}
      >
        Simpan
      </button>
      {saved && <p className="text-sm text-sage-500">Tersimpan</p>}
    </div>
  )
}

function QrisForm() {
  const settings = useLiveQuery(() => getSettings(), [])
  const [qrisImageDataUrl, setQrisImageDataUrl] = useState<string | null>(null)
  const [qrisMerchantName, setQrisMerchantName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setQrisImageDataUrl(settings.qrisImageDataUrl)
    setQrisMerchantName(settings.qrisMerchantName ?? '')
  }, [settings])

  if (!settings) return null

  return (
    <div className="max-w-md space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Gambar QRIS Statis Kafe</span>
        <input
          type="file"
          accept="image/*"
          className="text-sm text-ink-300"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) setQrisImageDataUrl(await readFileAsDataUrl(file))
          }}
        />
        {qrisImageDataUrl && <img src={qrisImageDataUrl} alt="QRIS" className="mt-2 h-48 w-48 rounded-xl bg-white object-contain p-2" />}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Nama Merchant (opsional)</span>
        <input className="input-field" value={qrisMerchantName} onChange={(e) => setQrisMerchantName(e.target.value)} />
      </label>
      <button
        className="btn-primary"
        onClick={async () => {
          await updateSettings({ qrisImageDataUrl, qrisMerchantName: qrisMerchantName || null })
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        }}
      >
        Simpan
      </button>
      {saved && <p className="text-sm text-sage-500">Tersimpan</p>}
    </div>
  )
}
