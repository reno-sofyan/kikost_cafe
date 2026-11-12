import type { BusinessType, PrinterConnectionType, ReceiptPaperSize } from '@/types/domain'

/** Urutan & nama 7 langkah Pengaturan Awal (judul sama dengan judul di tiap langkah). */
export type OnboardingStep = 'welcome' | 'profile' | 'fiscal' | 'qris' | 'printer' | 'admin' | 'finishing'

export const STEP_ORDER: OnboardingStep[] = ['welcome', 'profile', 'fiscal', 'qris', 'printer', 'admin', 'finishing']

export const STEP_META: Record<OnboardingStep, { label: string; hint: string; minutes: number }> = {
  welcome: { label: 'Selamat Datang', hint: 'Gambaran singkat', minutes: 0 },
  profile: { label: 'Profil Usaha', hint: 'Jenis usaha, nama, alamat & logo', minutes: 1 },
  fiscal: { label: 'Pajak & Biaya', hint: 'Pajak, service charge & nomor transaksi', minutes: 1 },
  qris: { label: 'QRIS & Ukuran Struk', hint: 'Gambar QRIS & kertas struk', minutes: 1 },
  printer: { label: 'Konfigurasi Printer', hint: 'Printer thermal (bisa nanti)', minutes: 1 },
  admin: { label: 'Akun Administrator', hint: 'Nama & PIN untuk masuk', minutes: 1 },
  finishing: { label: 'Menyiapkan Aplikasi', hint: 'Disiapkan otomatis', minutes: 0 },
}

/** Langkah yang diisi pengguna (tanpa sambutan & penyiapan otomatis). */
export const WORK_STEPS = STEP_ORDER.filter((s) => STEP_META[s].minutes > 0)
export const TOTAL_MINUTES = WORK_STEPS.reduce((sum, s) => sum + STEP_META[s].minutes, 0)

export type StepStatus = 'done' | 'active' | 'todo'

export function stepStatus(step: OnboardingStep, current: OnboardingStep): StepStatus {
  const i = STEP_ORDER.indexOf(step)
  const c = STEP_ORDER.indexOf(current)
  return i < c ? 'done' : i === c ? 'active' : 'todo'
}

const STATUS_TEXT: Record<StepStatus, string> = { done: 'selesai', active: 'sedang dikerjakan', todo: 'belum dikerjakan' }

/** Teks untuk pembaca layar, mis. "Langkah 2 dari 7, Profil Usaha, sedang dikerjakan". */
export function stepAriaLabel(step: OnboardingStep, current: OnboardingStep): string {
  return `Langkah ${STEP_ORDER.indexOf(step) + 1} dari ${STEP_ORDER.length}, ${STEP_META[step].label}, ${STATUS_TEXT[stepStatus(step, current)]}`
}

// ---- Draf progres (aman dihentikan & dilanjutkan) --------------------------------------

/**
 * Isian wizard yang disimpan tiap kali "Lanjut". SENGAJA tanpa PIN administrator — PIN
 * tak pernah ditulis ke penyimpanan dalam bentuk apa pun sebelum di-hash saat selesai.
 * Disimpan di localStorage (bukan skema pengaturan), dihapus begitu wizard selesai.
 */
export interface OnboardingDraft {
  step: OnboardingStep
  businessType: BusinessType
  withSampleCatalog: boolean
  withKantinCategories: boolean
  businessName: string
  address: string
  phone: string
  logoDataUrl: string | null
  taxPercent: number
  serviceChargePercent: number
  roundingIncrement: number
  transactionPrefix: string
  qrisImageDataUrl: string | null
  qrisMerchantName: string
  receiptPaperSize: ReceiptPaperSize
  printerType: PrinterConnectionType
  networkHost: string
  networkPort: number
  adminName: string
}

const DRAFT_KEY = 'kione.onboardingDraft'

export function saveOnboardingDraft(draft: OnboardingDraft): boolean {
  const write = (d: OnboardingDraft) => localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
  try {
    write(draft)
    return true
  } catch {
    // Penyimpanan penuh (gambar besar): simpan tanpa gambar — logo/QRIS dipilih ulang saja.
    try {
      write({ ...draft, logoDataUrl: null, qrisImageDataUrl: null })
      return true
    } catch {
      return false
    }
  }
}

export function loadOnboardingDraft(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<OnboardingDraft> & { adminPin?: unknown; adminPinConfirm?: unknown }
    if (!d.step || !STEP_ORDER.includes(d.step)) return null
    // Jaga-jaga: PIN tak pernah diambil dari draf, walau ada.
    delete d.adminPin
    delete d.adminPinConfirm
    return { ...d, step: resumeStep(d.step) } as OnboardingDraft
  } catch {
    return null
  }
}

export function clearOnboardingDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // abaikan
  }
}

/** Langkah lanjutan setelah dimuat ulang. Penyiapan yang terputus kembali ke akun admin (PIN diisi ulang). */
export function resumeStep(saved: OnboardingStep): OnboardingStep {
  return saved === 'finishing' ? 'admin' : saved
}
