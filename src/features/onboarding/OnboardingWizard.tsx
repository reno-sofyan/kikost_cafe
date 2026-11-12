import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { updateSettings } from '@/db/repositories/settings'
import { createUser } from '@/db/repositories/users'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { seedInitialCatalog } from '@/db/seed'
import { rememberSampleCatalog } from '@/db/sampleCatalog'
import { createKantinStarterCategories } from '@/db/repositories/categories'
import { useSessionStore } from '@/state/sessionStore'
import { isValidPinFormat } from '@/lib/pinHash'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { EASING, MOTION, prefersReducedMotion, routeKeyframes } from '@/lib/motion'
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
  STEP_META,
  STEP_ORDER,
  stepAriaLabel,
  stepStatus,
  TOTAL_MINUTES,
  WORK_STEPS,
  type OnboardingStep as Step,
} from '@/features/onboarding/onboardingSteps'
import { PRODUCT_MARK, PRODUCT_NAME } from '@/lib/brand'
import { BUSINESS_TYPE_DESCRIPTIONS, BUSINESS_TYPE_LABELS, BUSINESS_TYPE_ORDER, featuresForBusinessType } from '@/lib/businessType'
import type { BusinessType, PrinterConnectionType, ReceiptPaperSize } from '@/types/domain'

/** Jangan biarkan layar "Menyiapkan aplikasi..." nyangkut selamanya kalau salah satu
 * langkah gagal/hang (mis. WebView tablet tertentu bermasalah dengan WebCrypto). */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms)),
  ])
}

export function OnboardingWizard() {
  // Lanjutkan dari draf bila wizard pernah dihentikan/dimuat ulang (lihat onboardingSteps).
  const [draft] = useState(loadOnboardingDraft)
  const [step, setStep] = useState<Step>(draft?.step ?? 'welcome')
  const [error, setError] = useState<string | null>(null)
  /** Error per kolom — tampil tepat di bawah kolom yang salah. */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const login = useSessionStore((s) => s.login)

  const [businessType, setBusinessType] = useState<BusinessType>(draft?.businessType ?? 'lainnya')
  const [withSampleCatalog, setWithSampleCatalog] = useState(draft?.withSampleCatalog ?? true)
  const [withKantinCategories, setWithKantinCategories] = useState(draft?.withKantinCategories ?? true)
  const [businessName, setBusinessName] = useState(draft?.businessName ?? '')
  const [address, setAddress] = useState(draft?.address ?? '')
  const [phone, setPhone] = useState(draft?.phone ?? '')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(draft?.logoDataUrl ?? null)

  const [taxPercent, setTaxPercent] = useState(draft?.taxPercent ?? 0)
  const [serviceChargePercent, setServiceChargePercent] = useState(draft?.serviceChargePercent ?? 0)
  const [roundingIncrement, setRoundingIncrement] = useState(draft?.roundingIncrement ?? 100)
  const [transactionPrefix, setTransactionPrefix] = useState(draft?.transactionPrefix ?? 'TRX')

  const [qrisImageDataUrl, setQrisImageDataUrl] = useState<string | null>(draft?.qrisImageDataUrl ?? null)
  const [qrisMerchantName, setQrisMerchantName] = useState(draft?.qrisMerchantName ?? '')
  const [receiptPaperSize, setReceiptPaperSize] = useState<ReceiptPaperSize>(draft?.receiptPaperSize ?? '58mm')

  const [printerType, setPrinterType] = useState<PrinterConnectionType>(draft?.printerType ?? 'browser')
  const [networkHost, setNetworkHost] = useState(draft?.networkHost ?? '')
  const [networkPort, setNetworkPort] = useState(draft?.networkPort ?? 9100)

  const [adminName, setAdminName] = useState(draft?.adminName ?? '')
  const [adminPin, setAdminPin] = useState('')
  const [adminPinConfirm, setAdminPinConfirm] = useState('')

  const stepIndex = STEP_ORDER.indexOf(step)

  /** Simpan isian (tanpa PIN) setiap pindah langkah — aman bila aplikasi ditutup/dimuat ulang. */
  function persist(nextStep: Step) {
    const ok = saveOnboardingDraft({
      step: nextStep,
      businessType,
      withSampleCatalog,
      withKantinCategories,
      businessName,
      address,
      phone,
      logoDataUrl,
      taxPercent,
      serviceChargePercent,
      roundingIncrement,
      transactionPrefix,
      qrisImageDataUrl,
      qrisMerchantName,
      receiptPaperSize,
      printerType,
      networkHost,
      networkPort,
      adminName,
    })
    if (ok) setSavedAt(Date.now())
  }

  function goNext() {
    setError(null)
    // Cek kolom wajib langkah ini sebelum lanjut (aturan sama dengan pengecekan akhir).
    if (step === 'profile' && !businessName.trim()) return setFieldErrors({ businessName: BUSINESS_NAME_REQUIRED })
    setFieldErrors({})
    const idx = STEP_ORDER.indexOf(step)
    if (idx < STEP_ORDER.length - 1) {
      const next = STEP_ORDER[idx + 1]!
      persist(next)
      setStep(next)
    }
  }
  function goBack() {
    setError(null)
    setFieldErrors({})
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1]!)
  }
  /** Stepper: boleh kembali ke langkah yang sudah selesai (tak bisa melompat ke depan). */
  function goTo(target: Step) {
    if (stepStatus(target, step) !== 'done' || target === 'finishing') return
    setError(null)
    setStep(target)
  }

  // Transisi antar langkah: maju dari kanan, mundur dari kiri (pola layar lain, src/lib/motion.ts).
  const contentRef = useRef<HTMLDivElement>(null)
  const prevIndex = useRef(stepIndex)
  useLayoutEffect(() => {
    const from = prevIndex.current
    prevIndex.current = stepIndex
    const el = contentRef.current
    if (from === stepIndex || !el || typeof el.animate !== 'function') return
    el.animate(routeKeyframes(stepIndex > from ? 'forward' : 'back', prefersReducedMotion()), { duration: MOTION.route, easing: EASING.out })
  }, [stepIndex])

  // "Progres tersimpan" tampil sebentar setelah tiap langkah.
  useEffect(() => {
    if (savedAt == null) return
    const t = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  // Enter = lanjut, Esc = kembali — kecuali sedang di kolom yang memakai tombol itu sendiri.
  const keyActions = useRef({ goNext, goBack, finish: () => void handleFinish(), step })
  keyActions.current = { goNext, goBack, finish: () => void handleFinish(), step }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const a = keyActions.current
      if (a.step === 'finishing' || e.defaultPrevented) return
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'A') {
        e.preventDefault()
        if (a.step === 'admin') a.finish()
        else a.goNext()
      } else if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && a.step !== 'welcome') {
        e.preventDefault()
        a.goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleFinish() {
    setError(null)
    if (!businessName.trim()) {
      setFieldErrors({ businessName: BUSINESS_NAME_REQUIRED })
      setStep('profile')
      return
    }
    if (!adminName.trim()) {
      setFieldErrors({ adminName: 'Nama administrator wajib diisi' })
      setStep('admin')
      return
    }
    if (!isValidPinFormat(adminPin)) {
      setFieldErrors({ adminPin: 'PIN harus terdiri dari 4-8 digit angka' })
      setStep('admin')
      return
    }
    if (adminPin !== adminPinConfirm) {
      setFieldErrors({ adminPinConfirm: 'Konfirmasi PIN tidak cocok' })
      setStep('admin')
      return
    }
    setFieldErrors({})

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
            // Standar ritel: kasir menghitung laci dulu sebelum melihat kas seharusnya (bisa dimatikan di Pajak & Struk).
            ...(featuresForBusinessType(businessType).retailUi ? { blindClose: true, receiptFooterNote: 'Terima kasih telah berbelanja' } : {}),
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
          if (withSampleCatalog) await seedInitialCatalog(businessType)
          else if (businessType === 'kantin' && withKantinCategories) await createKantinStarterCategories()
          if (withSampleCatalog || (businessType === 'kantin' && withKantinCategories)) await rememberSampleCatalog()
          clearOnboardingDraft()
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
    <div className="kione-auth-bg flex h-full flex-col text-ink-50">
      <header className="flex-none border-b border-ink-700 bg-ink-900/90 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <img src={PRODUCT_MARK} alt="" className="h-7 w-7 rounded-lg" />
          <h1 className="text-base font-bold">Pengaturan Awal · {PRODUCT_NAME}</h1>
          <span className={`ml-3 flex items-center gap-1 text-xs font-medium text-success-500 transition-opacity ${savedAt ? 'opacity-100' : 'opacity-0'}`} role="status">
            {savedAt ? (
              <>
                <Icon name="checkCircle" size={14} /> Progres tersimpan
              </>
            ) : null}
          </span>
          <span className="ml-auto text-sm font-semibold text-ink-200">
            Langkah {stepIndex + 1} dari {STEP_ORDER.length}
          </span>
        </div>
        <Stepper current={step} onSelect={goTo} />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div ref={contentRef} className={`mx-auto ${step === 'welcome' ? 'max-w-4xl' : 'max-w-xl'}`}>
          {error && (
            <div className="mb-4 rounded-xl border border-red-300/50 bg-red-900 px-4 py-3 text-sm font-medium text-red-500">{error}</div>
          )}

          {step === 'welcome' && (
            <div className="grid items-center gap-8 pt-4 md:grid-cols-2">
              <div>
                <h2 className="text-3xl font-bold leading-tight">Selamat Datang di {PRODUCT_NAME}</h2>
                <p className="mt-3 text-ink-200">
                  Isi identitas usaha, pajak, pembayaran, printer, dan akun administrator. Semuanya masih bisa diubah nanti di Pengaturan.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="badge bg-brand-600/15 text-brand-400">
                    <Icon name="clock" size={14} /> ± {TOTAL_MINUTES} menit
                  </span>
                  <span className="badge bg-success-600/15 text-success-500">
                    <Icon name="checkCircle" size={14} /> Progres tersimpan otomatis
                  </span>
                </div>
              </div>
              <ol className="card divide-y divide-ink-700 overflow-hidden" aria-label="Langkah yang akan dikerjakan">
                {WORK_STEPS.map((s, i) => (
                  <li key={s} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 border-brand-500 text-sm font-bold text-brand-400">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink-50">{STEP_META[s].label}</span>
                      <span className="block text-xs text-ink-300">{STEP_META[s].hint}</span>
                    </span>
                    <span className="flex-none text-xs font-medium text-ink-300">± {STEP_META[s].minutes} menit</span>
                  </li>
                ))}
              </ol>
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
                  Menentukan menu & fitur yang dipakai (Meja, Dapur, Pesanan QR, Pager, dll.). <b>Tidak bisa diubah</b> setelah pengaturan awal selesai — pilih dengan teliti.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm text-ink-200">
                <input type="checkbox" className="mt-0.5" checked={withSampleCatalog} onChange={(e) => setWithSampleCatalog(e.target.checked)} />
                <span>
                  Isi katalog contoh
                  <span className="block text-xs text-ink-500">
                    Produk &amp; kategori contoh untuk mencoba-coba. Matikan bila ingin langsung memasukkan produk asli.
                  </span>
                </span>
              </label>
              {businessType === 'kantin' && !withSampleCatalog && (
                <label className="flex items-start gap-2 text-sm text-ink-200">
                  <input type="checkbox" className="mt-0.5" checked={withKantinCategories} onChange={(e) => setWithKantinCategories(e.target.checked)} />
                  <span>
                    Buat kategori standar kantin (tanpa produk)
                    <span className="block text-xs text-ink-500">
                      Masakan &amp; Minuman Seduh → dapur; Minuman Dingin, Es Krim, Snack &amp; Kerupuk → langsung dari kasir.
                    </span>
                  </span>
                </label>
              )}
              <Field label="Nama Usaha" error={fieldErrors.businessName}>
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
              <Field label="Nama Administrator" error={fieldErrors.adminName}>
                <input className="input-field" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </Field>
              <Field label="PIN (4-8 digit)" error={fieldErrors.adminPin}>
                <input
                  type="password"
                  inputMode="numeric"
                  className="input-field"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field label="Konfirmasi PIN" error={fieldErrors.adminPinConfirm}>
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
              <p className="text-sm text-ink-300">{withSampleCatalog ? 'Membuat akun administrator dan katalog contoh.' : 'Membuat akun administrator.'}</p>
            </div>
          )}
        </div>
      </div>

      {step !== 'finishing' && (
        <footer className="flex flex-none items-center justify-between border-t border-ink-700 bg-ink-900 px-6 py-4">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
            {/* Langkah pertama: Kembali disembunyikan (tak ada langkah sebelumnya); ruang tetap dijaga. */}
            {step === 'welcome' ? (
              <span className="hidden text-xs text-ink-300 sm:block">Tekan Enter untuk lanjut</span>
            ) : (
              <Button variant="secondary" size="lg" leftIcon={<Icon name="arrowLeft" size={18} />} onClick={goBack}>
                Kembali
              </Button>
            )}
            {step === 'admin' ? (
              <Button size="lg" className="ml-auto min-w-[12rem]" onClick={() => handleFinish()}>
                Selesai &amp; Mulai
              </Button>
            ) : (
              <Button size="lg" className="ml-auto min-w-[12rem]" rightIcon={<Icon name="chevronRight" size={18} />} onClick={goNext}>
                Lanjut
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  )
}

/** Stepper bernama: selesai (centang, bisa diklik untuk kembali), aktif, dan belum. */
export interface StepperProps {
  current: Step
  onSelect: (step: Step) => void
}

export function Stepper({ current, onSelect }: StepperProps) {
  return (
    <ol className="mx-auto mt-3 flex max-w-5xl gap-1.5" aria-label="Langkah pengaturan awal">
      {STEP_ORDER.map((s, i) => {
        const status = stepStatus(s, current)
        return (
          <li key={s} className="min-w-0 flex-1">
            <button
              type="button"
              aria-label={stepAriaLabel(s, current)}
              aria-current={status === 'active' ? 'step' : undefined}
              disabled={status !== 'done' || s === 'finishing'}
              onClick={() => onSelect(s)}
              className="group flex w-full flex-col gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default"
            >
              <span className={`h-1.5 w-full rounded-full ${status === 'todo' ? 'bg-ink-600' : 'bg-brand-600'} ${status === 'active' ? 'ring-2 ring-brand-500/30' : ''}`} />
              <span
                className={`flex items-center gap-1 truncate text-[0.7rem] font-semibold ${
                  status === 'active' ? 'text-brand-400' : status === 'done' ? 'text-ink-200 group-hover:text-ink-50' : 'text-ink-300'
                }`}
              >
                {status === 'done' ? <Icon name="check" size={12} className="flex-none" /> : <span className="flex-none tabular-nums">{i + 1}.</span>}
                <span className="truncate">{STEP_META[s].label}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

type FieldKey = 'businessName' | 'adminName' | 'adminPin' | 'adminPinConfirm'
const BUSINESS_NAME_REQUIRED = 'Nama usaha wajib diisi — nama ini muncul di struk dan halaman pesanan pelanggan'

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    // Pesan error di LUAR <label>: nama kolom untuk pembaca layar tetap sama.
    <div className={error ? 'kione-field--error' : undefined}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-300">{label}</span>
        {children}
      </label>
      {error && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-600">
          <Icon name="alertTriangle" size={15} className="mt-0.5 flex-none" />
          {error}
        </p>
      )}
    </div>
  )
}
