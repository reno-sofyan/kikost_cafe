import { useState, type ReactNode } from 'react'
import { updateSettings } from '@/db/repositories/settings'
import { createUser } from '@/db/repositories/users'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { seedInitialCatalog } from '@/db/seed'
import { useSessionStore } from '@/state/sessionStore'
import { isValidPinFormat } from '@/lib/pinHash'
import { Icon } from '@/components/ui/Icon'
import type { PrinterConnectionType, ReceiptPaperSize } from '@/types/domain'

type Step = 'welcome' | 'profile' | 'fiscal' | 'qris' | 'printer' | 'admin' | 'finishing'

const STEP_ORDER: Step[] = ['welcome', 'profile', 'fiscal', 'qris', 'printer', 'admin', 'finishing']

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>('welcome')
  const [error, setError] = useState<string | null>(null)
  const login = useSessionStore((s) => s.login)

  const [cafeName, setCafeName] = useState('Kafe Keluarga POS')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  const [taxPercent, setTaxPercent] = useState(0)
  const [serviceChargePercent, setServiceChargePercent] = useState(0)
  const [roundingIncrement, setRoundingIncrement] = useState(100)
  const [transactionPrefix, setTransactionPrefix] = useState('KKP')

  const [qrisImageDataUrl, setQrisImageDataUrl] = useState<string | null>(null)
  const [qrisMerchantName, setQrisMerchantName] = useState('')
  const [receiptPaperSize, setReceiptPaperSize] = useState<ReceiptPaperSize>('58mm')

  const [printerType, setPrinterType] = useState<PrinterConnectionType>('browser')
  const [networkHost, setNetworkHost] = useState('')
  const [networkPort, setNetworkPort] = useState(9100)

  const [adminName, setAdminName] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [adminPinConfirm, setAdminPinConfirm] = useState('')

  const stepIndex = STEP_ORDER.indexOf(step)

  function goNext() {
    setError(null)
    const idx = STEP_ORDER.indexOf(step)
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]!)
  }
  function goBack() {
    setError(null)
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1]!)
  }

  async function handleFinish() {
    if (!adminName.trim()) {
      setError('Nama administrator wajib diisi')
      setStep('admin')
      return
    }
    if (!isValidPinFormat(adminPin)) {
      setError('PIN harus terdiri dari 4-8 digit angka')
      setStep('admin')
      return
    }
    if (adminPin !== adminPinConfirm) {
      setError('Konfirmasi PIN tidak cocok')
      setStep('admin')
      return
    }

    setStep('finishing')
    await updateSettings({
      cafeName: cafeName.trim() || 'Kafe Keluarga POS',
      address,
      phone,
      logoDataUrl,
      taxPercent,
      serviceChargePercent,
      roundingIncrement,
      transactionPrefix: transactionPrefix.trim() || 'KKP',
      qrisImageDataUrl,
      qrisMerchantName: qrisMerchantName || null,
      receiptPaperSize,
      printerConfig: {
        connectionType: printerType,
        paperSize: receiptPaperSize,
        bluetoothAddress: null,
        bluetoothName: null,
        networkHost: printerType === 'network' ? networkHost : null,
        networkPort: printerType === 'network' ? networkPort : null,
        autoPrintOnPayment: false,
        autoPrintKitchenOrder: false,
      },
      onboardingCompleted: true,
    })

    const admin = await createUser({ name: adminName.trim(), role: 'administrator', pin: adminPin })
    await recordAuditLog({
      userId: admin.id,
      userName: admin.name,
      action: 'onboarding.completed',
      entityType: 'settings',
      entityId: 'singleton',
      details: 'Onboarding aplikasi selesai, akun administrator dibuat',
    })
    await seedInitialCatalog()
    login(admin)
  }

  return (
    <div className="flex h-full flex-col bg-ink-950 text-ink-50">
      <div className="flex-none border-b border-ink-800 px-6 py-4">
        <h1 className="text-lg font-bold">Pengaturan Awal Kikost Cafe POS</h1>
        <div className="mt-3 flex gap-1">
          {STEP_ORDER.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-brew-500' : 'bg-ink-800'}`} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-xl">
          {error && (
            <div className="mb-4 rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-300">{error}</div>
          )}

          {step === 'welcome' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brew-600/15 text-brew-600">
                <Icon name="coffee" size={32} />
              </div>
              <h2 className="text-2xl font-bold">Selamat Datang</h2>
              <p className="text-ink-300">
                Mari siapkan aplikasi kasir untuk kafe keluarga Anda. Proses ini hanya perlu dilakukan sekali.
              </p>
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Profil Kafe</h2>
              <Field label="Nama Kafe">
                <input className="input-field" value={cafeName} onChange={(e) => setCafeName(e.target.value)} />
              </Field>
              <Field label="Alamat">
                <textarea className="input-field" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              <Field label="Telepon">
                <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Logo (opsional)">
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
              </Field>
            </div>
          )}

          {step === 'fiscal' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Pajak &amp; Biaya</h2>
              <Field label="Pajak (%)">
                <input type="number" min={0} max={100} className="input-field" value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value))} />
              </Field>
              <Field label="Service Charge (%)">
                <input type="number" min={0} max={100} className="input-field" value={serviceChargePercent} onChange={(e) => setServiceChargePercent(Number(e.target.value))} />
              </Field>
              <Field label="Pembulatan Total (Rp)">
                <select className="input-field" value={roundingIncrement} onChange={(e) => setRoundingIncrement(Number(e.target.value))}>
                  <option value={1}>Tanpa pembulatan</option>
                  <option value={100}>Ke Rp 100 terdekat</option>
                  <option value={500}>Ke Rp 500 terdekat</option>
                  <option value={1000}>Ke Rp 1.000 terdekat</option>
                </select>
              </Field>
              <Field label="Awalan Nomor Transaksi">
                <input className="input-field" value={transactionPrefix} onChange={(e) => setTransactionPrefix(e.target.value.toUpperCase())} />
                <p className="mt-1 text-xs text-ink-500">Contoh hasil: {transactionPrefix || 'KKP'}-00001</p>
              </Field>
            </div>
          )}

          {step === 'qris' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">QRIS &amp; Ukuran Struk</h2>
              <Field label="Gambar QRIS Statis (opsional, bisa diisi nanti di Pengaturan)">
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm text-ink-300"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (file) setQrisImageDataUrl(await readFileAsDataUrl(file))
                  }}
                />
                {qrisImageDataUrl && <img src={qrisImageDataUrl} alt="QRIS" className="mt-2 h-32 w-32 object-contain" />}
              </Field>
              <Field label="Nama Merchant QRIS (opsional)">
                <input className="input-field" value={qrisMerchantName} onChange={(e) => setQrisMerchantName(e.target.value)} />
              </Field>
              <Field label="Ukuran Kertas Struk">
                <div className="flex gap-3">
                  {(['58mm', '80mm'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setReceiptPaperSize(size)}
                      className={`btn ${receiptPaperSize === size ? 'btn-primary' : 'btn-secondary'} flex-1`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {step === 'printer' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Konfigurasi Printer</h2>
              <p className="text-sm text-ink-400">
                Anda dapat menghubungkan printer thermal sekarang atau nanti melalui menu Pengaturan &gt; Printer.
              </p>
              <Field label="Jenis Koneksi">
                <select className="input-field" value={printerType} onChange={(e) => setPrinterType(e.target.value as PrinterConnectionType)}>
                  <option value="browser">Cetak lewat Browser/Sistem (PWA)</option>
                  <option value="bluetooth">Printer Bluetooth (khusus aplikasi Android)</option>
                  <option value="network">Printer WiFi/LAN (khusus aplikasi Android)</option>
                  <option value="none">Belum ada printer</option>
                </select>
              </Field>
              {printerType === 'network' && (
                <>
                  <Field label="Alamat IP Printer">
                    <input className="input-field" value={networkHost} onChange={(e) => setNetworkHost(e.target.value)} placeholder="192.168.1.50" />
                  </Field>
                  <Field label="Port">
                    <input type="number" className="input-field" value={networkPort} onChange={(e) => setNetworkPort(Number(e.target.value))} />
                  </Field>
                </>
              )}
              {printerType === 'bluetooth' && (
                <p className="text-xs text-ink-500">
                  Pemilihan perangkat Bluetooth dilakukan setelah aplikasi terpasang sebagai APK, di menu Pengaturan &gt; Printer.
                </p>
              )}
            </div>
          )}

          {step === 'admin' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Akun Administrator</h2>
              <Field label="Nama Administrator">
                <input className="input-field" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </Field>
              <Field label="PIN (4-8 digit)">
                <input
                  type="password"
                  inputMode="numeric"
                  className="input-field"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field label="Konfirmasi PIN">
                <input
                  type="password"
                  inputMode="numeric"
                  className="input-field"
                  value={adminPinConfirm}
                  onChange={(e) => setAdminPinConfirm(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
            </div>
          )}

          {step === 'finishing' && (
            <div className="space-y-4 text-center">
              <Icon name="refresh" size={40} className="mx-auto animate-spin text-brew-600" />
              <h2 className="text-xl font-bold">Menyiapkan aplikasi...</h2>
            </div>
          )}
        </div>
      </div>

      {step !== 'finishing' && (
        <div className="flex flex-none items-center justify-between border-t border-ink-800 px-6 py-4">
          <button onClick={goBack} disabled={step === 'welcome'} className="btn-ghost">
            Kembali
          </button>
          {step === 'admin' ? (
            <button onClick={() => void handleFinish()} className="btn-primary">
              Selesai &amp; Mulai
            </button>
          ) : (
            <button onClick={goNext} className="btn-primary">
              Lanjut
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-300">{label}</span>
      {children}
    </label>
  )
}
