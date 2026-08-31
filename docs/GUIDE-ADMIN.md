# Panduan Administrator

## Onboarding (sekali saja)

Saat aplikasi pertama dibuka:

1. **Profil kafe** — nama, logo, alamat, telepon.
2. **Pajak & biaya** — persen pajak, service charge, pembulatan (mis. 100), awalan
   nomor transaksi (mis. `KKP`).
3. **QRIS & struk** — unggah gambar QRIS statis kafe, pilih ukuran struk 58mm / 80mm,
   catatan footer.
4. **Printer** — pilih mode (none / browser / bluetooth / network). Bisa diubah nanti.
5. **Akun administrator** — nama + PIN (4–8 digit).
6. **Data contoh** — centang untuk mengisi katalog awal (5 kategori, modifier lengkap,
   produk & bahan contoh). Bisa dilewati dan diisi manual.

Onboarding tidak muncul lagi setelah selesai. Identitas kafe bisa diubah kapan saja di
**Pengaturan → Profil**.

## Pengguna & hak akses (Pengaturan → Pengguna)

Role: **Administrator, Supervisor, Kasir, Dapur**.

| Kemampuan | Admin | Supervisor | Kasir | Dapur |
|---|:-:|:-:|:-:|:-:|
| Terapkan diskon | ✅ | ✅ | ✅ | — |
| Ubah harga (override) | ✅ | ✅ | — | — |
| Batalkan transaksi | ✅ | ✅ | — | — |
| Retur | ✅ | ✅ | — | — |
| Sesuaikan stok | ✅ | ✅ | — | — |
| Lihat laporan | ✅ | ✅ | — | — |
| Kelola pengaturan | ✅ | — | — | — |
| Kelola pengguna | ✅ | — | — | — |
| Kelola shift | ✅ | ✅ | ✅ | — |

- PIN di-hash (PBKDF2-SHA256). Tidak pernah disimpan/di-log sebagai teks.
- Tindakan sensitif (void, retur, override harga) minta **PIN supervisor/admin**.
- **Audit log** (Pengaturan → Audit Log): siapa, kapan, tindakan apa.
- **Kunci layar otomatis**: atur menit di Pengaturan.

## Produk & kategori (Produk)

- CRUD kategori & produk. Produk: nama, deskripsi, **SKU & barcode** (harus unik),
  foto, **harga jual**, **HPP (cost)**, satuan (pcs/g/kg/ml/l), stok, ambang stok menipis,
  favorit, status tersedia, grup modifier.
- **Impor/Ekspor CSV** untuk produk.
- Produk **habis** (stok 0 atau bahan utama habis) otomatis **tidak bisa dijual**.

## Modifier (Produk → Modifier)

Grup: Ukuran, Level Gula, Level Es, Topping, Kepedasan, Catatan. Wajib/opsional,
single/multi-select, `priceDelta` per opsi (menambah harga).

## Stok & bahan baku (Stok)

- Kelola **produk** (stok sendiri) dan **bahan baku** (ingredient) + **resep/BOM**.
- Penjualan mengurangi stok produk **atau** bahan baku sesuai resep — **tepat satu kali**.
- Penyesuaian stok, stok masuk, stok keluar, **waste** — semua tercatat di riwayat
  pergerakan stok dengan alasan.
- Stok menipis ditandai. Produk dengan bahan utama habis otomatis nonaktif.

## Laporan (Laporan)

Filter tanggal (harian/mingguan/bulanan, zona **Asia/Jakarta**). Isi:

- Omzet, jumlah transaksi, rata-rata transaksi
- Produk terjual & terlaris, penjualan per kategori / kasir / metode bayar
- Diskon, pajak, service charge, retur, pembatalan, pengeluaran
- **Laba kotor** berdasarkan HPP
- Laporan shift & laporan stok
- **Ekspor CSV / PDF**

## Pelanggan (Pelanggan)

Nama, telepon, email (opsional), catatan, riwayat pembelian, produk favorit.

## Sinkronisasi (Pengaturan → Sinkronisasi)

- Status Online/Offline, jumlah data belum tersinkron, log kegagalan.
- **Sinkronkan Sekarang** memaksa satu siklus.
- Masukkan **kunci perangkat** (dari administrator VPS, satu per tablet).
- Aplikasi tetap berfungsi penuh walau backend belum dikonfigurasi; data menyusul.

## Backup & restore (Pengaturan → Backup)

- **Ekspor Backup** — file JSON seluruh data lokal tablet ini. Lakukan rutin, simpan
  di luar tablet.
- **Restore Backup** — menimpa seluruh data lokal. Konfirmasi eksplisit; hanya untuk
  memulihkan/menyiapkan tablet baru.
- Backup **server** (PostgreSQL) otomatis harian di VPS — lihat `BACKUP-RESTORE.md`.

## Menyiapkan tablet baru

1. Pasang APK (`ANDROID-APK.md`) atau install PWA dari Chrome.
2. Jika tablet pertama: jalankan onboarding. Jika bukan: setelah backend aktif, data
   akan tersinkron; atau restore dari backup JSON tablet lama.
3. Pengaturan → Sinkronisasi → masukkan kunci perangkat.
4. Verifikasi: buat transaksi uji, cek sinkron, lalu batalkan transaksi uji tersebut.
