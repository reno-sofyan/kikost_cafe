/**
 * URL halaman pesan-mandiri yang ditanam ke dalam QR meja.
 *
 * Basis URL kosong (belum diisi di Pengaturan → Meja & QR) sengaja jatuh ke
 * origin perangkat ini: pada pemasangan PWA, alamat itu memang alamat yang
 * dipakai pelanggan. Di dalam APK Android, origin-nya `https://localhost`, yang
 * tidak bisa dibuka pelanggan — jadi pemanggil tetap harus memeriksa
 * `qrOrderBaseUrlIsUsable()` sebelum menawarkan cetak QR.
 */
export function orderUrl(base: string, token: string): string {
  const root = (base.trim() || window.location.origin).replace(/\/+$/, '')
  return `${root}/order/${token}`
}

/** False bila QR yang dihasilkan tidak akan bisa dibuka dari ponsel pelanggan. */
export function qrOrderBaseUrlIsUsable(base: string): boolean {
  const root = base.trim() || window.location.origin
  return /^https?:\/\//.test(root) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(root)
}
