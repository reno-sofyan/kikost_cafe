/**
 * Identitas produk (Kione POS) — dipisah dari identitas pemilik usaha.
 *
 * Dua merek hidup berdampingan di aplikasi ini, dan keduanya punya tempat
 * masing-masing:
 *
 * - **Merek produk** (berkas ini) muncul di permukaan yang memang milik
 *   aplikasi: onboarding, layar kunci, splash, "Tentang", nama APK.
 * - **Merek pemilik usaha** (`settings.businessName` + `settings.logoDataUrl`)
 *   muncul di permukaan operasional & yang dilihat pelanggan: header aplikasi,
 *   layar masuk, struk, tiket dapur, halaman pesan-mandiri QR.
 *
 * Aturan praktisnya: kalau yang melihat adalah pelanggan atau pegawai outlet,
 * tampilkan merek usaha. Kalau yang dijelaskan adalah aplikasinya sendiri,
 * tampilkan Kione POS.
 */

export const PRODUCT_NAME = 'Kione POS'
export const PRODUCT_TAGLINE = 'Kasir offline-first untuk kafe, restoran, dan ritel'
export const PRODUCT_VERSION = __APP_VERSION__

/** Logo produk penuh (mark + wordmark). Latar transparan, untuk permukaan terang. */
export const PRODUCT_LOGO = '/brand/logo-full.png'
/** Mark persegi saja — untuk ruang sempit seperti rel navigasi. */
export const PRODUCT_MARK = '/brand/mark.png'
