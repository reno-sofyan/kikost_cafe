/**
 * Pemindai barcode USB/Bluetooth mode "keyboard" (HID / keyboard wedge), mis. pemindai
 * laser 1D dengan stand auto-sense: kode "diketik" sangat cepat (beberapa ms per
 * karakter) lalu diakhiri Enter/Tab. Pendeteksi ini membedakan semburan pemindai dari
 * ketikan manusia berdasarkan jeda antar karakter — tanpa driver atau izin khusus,
 * jalan sama di browser, PWA, dan APK Android (USB OTG).
 */

export type WedgeTerminator = 'auto' | 'none'

export interface WedgeConfig {
  /** Jeda maksimum antar karakter (ms) agar dianggap dari pemindai. */
  maxGapMs: number
  /** Panjang kode minimum (karakter). */
  minLength: number
  /**
   * `auto` = kode diakhiri Enter atau Tab (bawaan hampir semua pemindai).
   * `none` = pemindai tanpa akhiran: kode selesai saat tak ada karakter lagi.
   */
  terminator: WedgeTerminator
  /** Abaikan kode yang SAMA dalam rentang ini (ms) — mis. stand auto-sense membaca dua kali. 0 = mati. */
  dedupeMs: number
}

export const DEFAULT_WEDGE_CONFIG: WedgeConfig = { maxGapMs: 50, minLength: 4, terminator: 'auto', dedupeMs: 0 }

export interface WedgeScan {
  code: string
  /** Rata-rata jeda antar karakter (ms) — untuk halaman uji. */
  avgGapMs: number
  terminator: 'Enter' | 'Tab' | 'idle'
}

export type WedgeResult =
  | { kind: 'none' }
  /** Kode lengkap terbaca — pemanggil menelan tombol akhiran (Enter tak boleh menekan tombol lain). */
  | { kind: 'scan'; scan: WedgeScan }
  /** Kode sama dibaca ulang dalam `dedupeMs` — tetap telan akhirannya, tapi jangan diproses. */
  | { kind: 'duplicate'; scan: WedgeScan }

export class WedgeDetector {
  private buffer = ''
  private firstAt = 0
  private lastAt = 0
  private lastScan: { code: string; at: number } | null = null

  constructor(public config: WedgeConfig = DEFAULT_WEDGE_CONFIG) {}

  reset(): void {
    this.buffer = ''
  }

  /** Satu `keydown` (`key` = `KeyboardEvent.key`, `at` = waktu ms). */
  key(key: string, at: number): WedgeResult {
    if (key.length === 1) {
      // Jeda panjang = ketikan baru (manusia, atau pindaian berikutnya) — mulai ulang.
      if (!this.buffer || at - this.lastAt > this.config.maxGapMs) {
        this.buffer = key
        this.firstAt = at
      } else {
        this.buffer += key
      }
      this.lastAt = at
      return { kind: 'none' }
    }
    // Shift dkk. dikirim pemindai untuk huruf besar — bukan pemutus kode.
    if (key === 'Shift' || key === 'CapsLock' || key === 'Unidentified') return { kind: 'none' }
    if ((key === 'Enter' || key === 'Tab') && this.config.terminator === 'auto') {
      // Akhiran boleh datang sedikit lebih lambat dari karakter terakhir.
      const result = at - this.lastAt <= this.config.maxGapMs * 3 ? this.finish(key, at) : { kind: 'none' as const }
      this.buffer = ''
      return result
    }
    this.buffer = ''
    return { kind: 'none' }
  }

  /** Mode tanpa akhiran: panggil setelah tak ada karakter selama ±3× `maxGapMs`. */
  idle(at: number): WedgeResult {
    if (this.config.terminator !== 'none' || !this.buffer || at - this.lastAt < this.config.maxGapMs) return { kind: 'none' }
    const result = this.finish('idle', at)
    this.buffer = ''
    return result
  }

  private finish(terminator: WedgeScan['terminator'], at: number): WedgeResult {
    const code = this.buffer.trim()
    if (code.length < this.config.minLength) return { kind: 'none' }
    const scan: WedgeScan = { code, avgGapMs: code.length > 1 ? (this.lastAt - this.firstAt) / (this.buffer.length - 1) : 0, terminator }
    const duplicate = !!this.lastScan && this.config.dedupeMs > 0 && this.lastScan.code === code && at - this.lastScan.at < this.config.dedupeMs
    this.lastScan = { code, at }
    return duplicate ? { kind: 'duplicate', scan } : { kind: 'scan', scan }
  }
}

const STORAGE_KEY = 'kione.scanner.config'

/** Pengaturan pemindai per perangkat (pemindainya menempel di tablet ini). */
export function readWedgeConfig(): WedgeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WEDGE_CONFIG
    const parsed = JSON.parse(raw) as Partial<WedgeConfig>
    return {
      maxGapMs: clamp(parsed.maxGapMs, 10, 200, DEFAULT_WEDGE_CONFIG.maxGapMs),
      minLength: clamp(parsed.minLength, 1, 30, DEFAULT_WEDGE_CONFIG.minLength),
      terminator: parsed.terminator === 'none' ? 'none' : 'auto',
      dedupeMs: clamp(parsed.dedupeMs, 0, 5000, 0),
    }
  } catch {
    return DEFAULT_WEDGE_CONFIG
  }
}

export function writeWedgeConfig(config: WedgeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    window.dispatchEvent(new Event(WEDGE_CONFIG_EVENT))
  } catch {
    /* preferensi perangkat — boleh hilang */
  }
}

/** Dipancarkan saat pengaturan pemindai berubah (hook memuat ulang konfigurasinya). */
export const WEDGE_CONFIG_EVENT = 'kione:scanner-config'

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
}
