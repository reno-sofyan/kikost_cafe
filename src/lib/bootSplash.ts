import { BUSINESS_TYPE_LABELS } from '@/lib/businessType'
import type { BusinessType } from '@/types/domain'

/**
 * Aturan splash saat aplikasi kasir dibuka (cold start). Yang menentukan kapan splash
 * selesai hanya database lokal (IndexedDB) & pengaturan — TIDAK pernah internet, supaya
 * kasir bisa langsung bekerja walau offline.
 */

/** Tampil minimal selama ini supaya tidak berkedip saat data lokal siap seketika. */
export const SPLASH_MIN_MS = 900
/** Versi "kurangi gerakan": logo statis, cukup sekilas. */
export const SPLASH_REDUCED_MIN_MS = 300
/** Belum siap setelah ini → tampilkan keterangan "Menyiapkan data lokal…". */
export const SPLASH_SLOW_HINT_MS = 2000
/** Database lokal tak merespons selama ini → anggap gagal, tampilkan "Coba lagi". */
export const SPLASH_TIMEOUT_MS = 15_000
/** Lama splash memudar sebelum layar utama terlihat penuh. */
export const SPLASH_FADE_MS = 250

/**
 * Sisa waktu splash setelah data siap. Data yang siap sebelum durasi minimal tetap
 * menunggu sampai minimal tercapai; yang siap setelahnya langsung ditutup (0).
 */
export function remainingSplashMs(startedAt: number, readyAt: number, minMs: number): number {
  return Math.max(0, startedAt + minMs - readyAt)
}

export class BootTimeoutError extends Error {
  constructor() {
    super('Database lokal tidak merespons.')
    this.name = 'BootTimeoutError'
  }
}

/** Menolak dengan `BootTimeoutError` bila `task` belum selesai dalam `ms`. */
export function withBootTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BootTimeoutError()), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Pesan yang dimengerti kasir untuk kegagalan inisialisasi. `reload` = "Coba lagi" harus
 * memuat ulang halaman: browser mengingat modul yang gagal diunduh, jadi mengulang
 * `import()` saja akan gagal lagi.
 */
export function bootErrorMessage(error: unknown): { title: string; detail: string; reload?: boolean } {
  if (error instanceof BootTimeoutError) {
    return {
      title: 'Database lokal tidak merespons',
      detail: 'Penyimpanan di perangkat ini sedang sibuk atau penuh. Tutup aplikasi lain, lalu coba lagi.',
    }
  }
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/QuotaExceeded|quota/i.test(raw)) {
    return { title: 'Penyimpanan perangkat penuh', detail: 'Kosongkan sebagian ruang penyimpanan tablet, lalu coba lagi.' }
  }
  if (/chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(raw)) {
    return { title: 'Berkas aplikasi belum termuat', detail: 'Sebagian berkas aplikasi gagal dimuat. "Coba lagi" akan memuat ulang aplikasi.', reload: true }
  }
  return { title: 'Data lokal gagal dibuka', detail: 'Database di perangkat ini tidak bisa dibuka. Coba lagi; data Anda tidak dihapus.' }
}

// ---- Gaya splash per jenis usaha -------------------------------------------------

/** Jenis usaha & nama usaha terakhir, disimpan agar splash cold start langsung bergaya sesuai POS-nya. */
export interface BootBrand {
  businessType: BusinessType
  businessName: string
}

const BOOT_BRAND_KEY = 'kione.bootBrand'
const KNOWN_TYPES = Object.keys(BUSINESS_TYPE_LABELS) as BusinessType[]

export function readBootBrand(): BootBrand | null {
  try {
    const raw = localStorage.getItem(BOOT_BRAND_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BootBrand>
    if (!parsed.businessType || !KNOWN_TYPES.includes(parsed.businessType)) return null
    return { businessType: parsed.businessType, businessName: typeof parsed.businessName === 'string' ? parsed.businessName : '' }
  } catch {
    return null
  }
}

export function rememberBootBrand(brand: BootBrand): void {
  try {
    localStorage.setItem(BOOT_BRAND_KEY, JSON.stringify(brand))
  } catch {
    // Penyimpanan diblokir/penuh: splash berikutnya memakai gaya Kione standar.
  }
}

export type SplashIcon = 'coffee' | 'bowl' | 'cart' | 'washer' | 'receipt'

export interface SplashStyle {
  /** `retail` = latar biru penuh (gaya layar Minimarket); `default` = kanvas terang. */
  variant: 'default' | 'retail'
  icon: SplashIcon
  /** Label jenis usaha; kosong sebelum onboarding (gaya Kione standar). */
  label: string
}

const ICONS: Record<BusinessType, SplashIcon> = {
  cafe_resto: 'coffee',
  kantin: 'bowl',
  minimarket: 'cart',
  laundry: 'washer',
  lainnya: 'receipt',
}

/** Kafe, kantin & laundry memakai gaya indigo Kione; minimarket gaya ritel biru. */
export function splashStyleFor(brand: BootBrand | null): SplashStyle {
  if (!brand) return { variant: 'default', icon: 'receipt', label: '' }
  return {
    variant: brand.businessType === 'minimarket' ? 'retail' : 'default',
    icon: ICONS[brand.businessType],
    label: BUSINESS_TYPE_LABELS[brand.businessType],
  }
}

export { prefersReducedMotion } from '@/lib/motion'

// ---- Kembali dari background --------------------------------------------------------

/** Indikator "kembali" hanya bila aplikasi cukup lama di background (bukan sekadar notifikasi sekilas). */
export const RESUME_MIN_AWAY_MS = 30_000
/** Lama indikator kecil tampil. */
export const RESUME_SHOW_MS = 1500

export function shouldShowResume(hiddenAt: number | null, now: number, minAwayMs = RESUME_MIN_AWAY_MS): boolean {
  return hiddenAt != null && now - hiddenAt >= minAwayMs
}
