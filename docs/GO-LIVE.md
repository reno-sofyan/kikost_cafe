# Persiapan Go-Live — Kikost Cafe (1 tablet)

Checklist sebelum aplikasi dipakai untuk transaksi sungguhan. Setup ini untuk
**satu tablet tanpa sinkronisasi server** — jaring pengaman datanya adalah
**backup manual berkala**.

## 1. Pasang APK

1. Kirim `app-release.apk` ke tablet (WhatsApp / Google Drive / kabel USB).
2. Settings Android → izinkan "Install unknown apps" untuk aplikasi file manager.
3. Buka APK → Install → buka aplikasi.
4. Aplikasi terkunci mode lanskap — pasang tablet horizontal.

## 2. Onboarding (sekali)

Isi wizard: Profil Kafe → Pajak & Service Charge → QRIS (bisa nanti) → Printer
(bisa nanti) → **buat akun Administrator + PIN**. Catat PIN di tempat aman.

## 3. Input katalog asli

Menu **Produk**:
- Semua produk: nama, **harga jual**, kategori.
- **HPP / modal per produk** (dipakai laporan laba kotor) — via resep bahan atau
  isi manual di form produk.
- Modifier (ukuran, level gula/es, topping) bila ada.

Menu **Stok**: set stok awal tiap bahan/produk yang dilacak.

Menu **Pengguna**: tambah akun kasir (role `kasir`) dengan PIN masing-masing.

## 4. Hardware (uji langsung — belum bisa dites tanpa alat)

- **Printer** (Pengaturan → Printer): pilih Bluetooth atau WiFi/LAN, hubungkan,
  **cetak 1 struk uji**.
- **Barcode scanner**: pasangkan sebagai keyboard (mode HID), scan 1 produk di
  layar Kasir → harus langsung masuk keranjang.
- Kamera: uji foto bukti di menu Pengeluaran.

## 5. Backup — WAJIB jadi kebiasaan

Tanpa server, **satu-satunya** cara data selamat kalau tablet rusak/hilang:

- **Tiap tutup toko**: Pengaturan → Backup → **Unduh Backup Sekarang** → pilih
  **Google Drive / WhatsApp / email** di menu bagikan.
- Header aplikasi menampilkan peringatan **"Backup: X hari lalu"** kalau sudah
  lewat ~1,5 hari sejak backup terakhir. Jangan diabaikan.
- Simpan minimal 7 file backup terakhir.
- **Pulihkan** (tablet baru/rusak): Pengaturan → Backup → Pilih File Backup →
  konfirmasi. Menimpa seluruh data perangkat.

## 6. Keystore rilis — simpan aman (untuk update APK di masa depan)

File `kikost-pos-release.jks` + password-nya harus disimpan di luar laptop
(password manager / drive terenkripsi). Hilang = tidak bisa update APK yang sudah
terpasang (harus uninstall + install ulang, data hilang).

## 7. Operasional harian

| Kapan | Aksi |
|---|---|
| Buka toko | Login PIN → menu Shift → **Buka Shift** (isi modal laci) |
| Per pesanan | Kasir → **+ Pesanan Baru** → pilih Dine-in/Takeaway → (opsional catatan nama pelanggan) → Mulai Pesanan → tambah item → **Bayar** |
| Tutup toko | menu Shift → **Tutup Shift** (hitung uang, cek selisih) → **Backup** (langkah 5) |

## Opsional: sinkronisasi + backup server

Kalau nanti pakai >1 perangkat atau mau backup otomatis di server: aktifkan di
Pengaturan → Sinkronisasi (URL `https://pos.kikost.com` + device key). Butuh
`CORS_ORIGINS` di server mencakup `https://localhost` (lihat
`docs/DEPLOYMENT-COOLIFY.md`).
