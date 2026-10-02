import { useState, type ReactNode } from 'react'
import { updateSettings } from '@/db/repositories/settings'
import { createUser } from '@/db/repositories/users'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { seedInitialCatalog } from '@/db/seed'
import { useSessionStore } from '@/state/sessionStore'
import { isValidPinFormat } from '@/lib/pinHash'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { Icon } from '@/components/ui/Icon'
import { PRODUCT_LOGO, PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/brand'
import { BUSINESS_TYPE_DESCRIPTIONS, BUSINESS_TYPE_LABELS, BUSINESS_TYPE_ORDER, featuresForBusinessType } from '@/lib/businessType'
import type { BusinessType, PrinterConnectionType, ReceiptPaperSize } from '@/types/domain'

type Step = 'welcome' | 'profile' | 'fiscal' | 'qris' | 'printer' | 'admin' | 'finishing'

const STEP_ORDER: Step[] = ['welcome', 'profile', 'fiscal', 'qris', 'printer', 'admin', 'finishing']

/** Jangan biarkan layar "Menyiapkan aplikasi..." nyangkut selamanya kalau salah satu
 * langkah gagal/hang (mis. WebView tablet tertentu bermasalah dengan WebCrypto). */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms)),
  ])
}

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>('welcome')
  const [error, setError] = useState<string | null>(null)
  const login = useSessionStore((s) => s.login)

  const [businessType, setBusinessType] = useState<BusinessType>('lainnya')
  const [businessName, setBusinessName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  const [taxPercent, setTaxPercent] = useState(0)
  const [serviceChargePercent, setServiceChargePercent] = useState(0)
  const [roundingIncrement, setRoundingIncrement] = useState(100)
  const [transactionPrefix, setTransactionPrefix] = useState('TRX')

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
    if (!businessName.trim()) {
      setError('Nama usaha wajib diisi — nama ini muncul di struk dan halaman pesanan pelanggan')
      setStep('profile')
      return
    }
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
    try {
      await withTimeout(
        (async () => {
          await updateSettings({
            businessName: businessName.trim(),
            businessType,
            address,
            phone,
            logoDataUrl,
            taxPercent,
            // Jenis usaha bisa diganti setelah mengisi service charge — jangan simpan nilai yang isiannya tersembunyi.
            serviceChargePercent: featuresForBusinessType(businessType).serviceCharge ? serviceChargePercent : 0,
            roundingIncrement,
            transactionPrefix: transactionPrefix.trim().toUpperCase() || 'TRX',
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
          await seedInitialCatalog(businessType)
          login(admin)
        })(),
        20_000,
        'Waktu tunggu habis (20 detik). Coba lagi — kalau berulang, mungkin ada masalah penyimpanan di perangkat ini.',
      )
    } catch (e) {
      setStep('admin')
      setError(e instanceof Error ? `Gagal menyiapkan aplikasi: ${e.message}` : 'Gagal menyiapkan aplikasi. Coba lagi.')
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-950 text-ink-50">
      <div className="flex-none border-b border-ink-700 bg-ink-900 px-6 py-4">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <img src={PRODUCT_MARK} alt="" className="h-7 w-7 rounded-lg" />
          <h1 className="text-base font-bold">Pengaturan Awal · {PRODUCT_NAME}</h1>
          <span className="ml-auto text-xs font-medium text-ink-400">
            Langkah {stepIndex + 1} / {STEP_ORDER.length}
          </span>
        </div>
        <div className="mx-auto mt-3 flex max-w-xl gap-1">
          {STEP_ORDER.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-brand-600' : 'bg-ink-700'}`} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-xl">
          {error && (
            <div className="mb-4 rounded-xl border border-red-300/50 bg-red-900 px-4 py-3 text-sm font-medium text-red-500">{error}</div>
          )}

          {step === 'welcome' && (
            <div className="flex flex-col items-center gap-5 pt-8 text-center">
              <img src={PRODUCT_LOGO} alt={PRODUCT_NAME} className="h-14 w-auto" />
              <div>
                <h2 className="text-2xl font-bold">Selamat Datang</h2>
                <p className="mx-auto mt-2 max-w-sm text-ink-300">
                  {PRODUCT_TAGLINE}. Lengkapi konfigurasi berikut untuk menyiapkan aplikasi dengan identitas usaha Anda
                  — cukup sekali, dan semuanya masih bisa diubah nanti lewat menu Pengaturan.
                </p>
              </div>
              <ul className="mt-2 w-full max-w-sm space-y-2 text-left text-sm text-ink-200">
                {['Nama, alamat & logo usaha Anda', 'Pajak, biaya layanan & format struk', 'QRIS & printer', 'Akun administrator'].map((t) => (
                  <li key={t} className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-600/15 text-brand-600">
                      <Icon name="check" size={13} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Profil Usaha</h2>
              <p className="text-sm text-ink-300">
                Nama dan logo ini yang tampil di aplikasi, struk, dan halaman pesanan yang dibuka pelanggan — bukan merek {PRODUCT_NAME}.
              </p>
              {/* BUKAN <Field> di sini dengan sengaja — Field membungkus isinya dalam SATU
                  elemen <label>, dan sebuah <label> yang membungkus beberapa <button>
                  (bukan satu kontrol form) membuat browser mencampur teks label ke nama
                  aksesibel SETIAP tombol di dalamnya — pembaca layar jadi mengumumkan teks
                  yang salah/tercampur untuk tiap kartu. Grid pilihan pakai <div> + <span>
                  label biasa, sama seperti pola yang sudah dipakai di Pengaturan. */}
              <div className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink-300">Jenis Usaha</span>
                <div className="grid grid-cols-2 gap-2">
                  {BUSINESS_TYPE_ORDER.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBusinessType(t)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        businessType === t ? 'border-brand-500 bg-brand-600/12' : 'border-ink-700 bg-ink-900 hover:border-ink-500'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-ink-50">{BUSINESS_TYPE_LABELS[t]}</span>
                      <span className="mt-0.5 block text-xs text-ink-400">{BUSINESS_TYPE_DESCRIPTIONS[t]}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-ink-500">
                  Menentukan menu mana yang ditampilkan (Meja, Dapur, Pesanan QR, Pager). Bisa diubah lagi nanti di Pengaturan.
                </p>
              </div>
              <Field label="Nama Usaha">
                <input
                  className="input-field"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="mis. Kopi Senja, Warung Bu Tuti, Toko Makmur"
                />
              </Field>
              <Field label="Alamat">
                <textarea className="input-field" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              <Field label="Telepon">
                <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Logo Usaha (opsional)">
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm text-ink-300"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (file) setLogoDataUrl(await readFileAsResizedDataUrl(file))
                  }}
                />
                <p className="mt-1 text-xs text-ink-400">
                  Paling rapi memakai gambar persegi. Bila dikosongkan, inisial nama usaha yang dipakai.
                </p>
                {logoDataUrl && <img src={logoDataUrl} alt="Pratinjau logo" className="mt-2 h-16 w-16 rounded-xl object-cover" />}
              </Field>
            </div>
          )}

          {step === 'fiscal' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Pajak &amp; Biaya</h2>
              <Field label="Pajak (%)">
                <input type="number" min={0} max={100} className="input-field" value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value))} />
              </Field>
              {featuresForBusinessType(businessType).serviceCharge && (
                <Field label="Service Charge (%)">
                  <input type="number" min={0} max={100} className="input-field" value={serviceChargePercent} onChange={(e) => setServiceChargePercent(Number(e.target.value))} />
                </Field>
              )}
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
                <p className="mt-1 text-xs text-ink-500">Contoh hasil: {transactionPrefix || 'TRX'}-00001</p>
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
                    if (file) setQrisImageDataUrl(await readFileAsResizedDataUrl(file))
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
              <Icon name="refresh" size={40} className="mx-auto animate-spin text-brand-600" />
              <h2 className="text-xl font-bold">Menyiapkan aplikasi…</h2>
              <p className="text-sm text-ink-300">Membuat akun administrator dan katalog contoh.</p>
            </div>
          )}
        </div>
      </div>

      {step !== 'finishing' && (
        <div className="flex flex-none items-center justify-between border-t border-ink-700 bg-ink-900 px-6 py-4">
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
