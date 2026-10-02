# Checklist Testing Manual

Daftar uji manual di tablet/perangkat nyata — pelengkap `TEST-PLAN.md` (hasil
suite otomatis). Pakai ini sebelum go-live, setelah update besar, atau setiap
kali ganti/tambah hardware (printer, pager, tablet baru).

Cara pakai: centang `[x]` tiap butir yang lulus. Butir bertanda **⚠ HW** butuh
perangkat fisik (tidak bisa diuji otomatis di CI). Catat tanggal + siapa yang
menguji di bagian paling bawah.

---

## 1. Onboarding & Login

- [ ] Instal ulang/reset app (atau buka di profil browser baru) → wizard onboarding 6 langkah muncul, bukan langsung ke Kasir.
- [ ] Isi Profil Usaha (nama wajib), pilih **Jenis Usaha** (Kafe & Restoran / Kantin / Minimarket) → cek menu kiri berubah sesuai (lihat `src/lib/businessType.ts` untuk pemetaan fitur per jenis usaha).
- [ ] Selesaikan wizard → data contoh (produk, kategori) ter-seed, langsung ke Kasir (bukan wizard lagi).
- [ ] Reload halaman → **tidak** kembali ke wizard (onboarding hanya sekali).
- [ ] Logout → layar "Pilih akun" muncul, PIN salah 5x → terkunci 30 detik.
- [ ] Diamkan layar beberapa menit (sesuai `autoLockMinutes`) → terkunci otomatis, PIN diminta lagi.
- [ ] Ubah Jenis Usaha di Pengaturan → Profil Usaha setelah onboarding → menu kiri ikut berubah tanpa kehilangan data.

## 2. Kasir & Transaksi Inti

- [ ] Buka Shift dulu → tanpa shift, tombol bayar tidak bisa diselesaikan.
- [ ] Buat pesanan dine-in (pilih meja), takeaway, dan delivery — ketiganya bisa dibuat & dibayar.
- [ ] Data contoh saat onboarding sesuai jenis usaha: Kafe → menu kopi + resep; Kantin → nasi/mie/teh manis + modifier pedas/es; Minimarket → barang kemasan ber-barcode tanpa modifier.
- [ ] Kantin: "Pesanan Baru" hanya menawarkan Dine-in / Takeaway, tanpa jumlah tamu & pilihan meja. Tap produk polos yang sama 3x → satu baris qty 3. Layar sukses bayar menampilkan **Nomor Antrean** besar.
- [ ] Minimarket: tanpa dialog "Pesanan Baru" — pindai barcode / tap produk langsung membuka transaksi; tap beruntun cepat **tidak** membuat dua transaksi. Pindai barcode yang sama 2x → satu baris qty 2. Tombol "Kirim ke Dapur", tab Produk → Modifier, Stok → Produksi, isian Service Charge, nomor antrean, dan baris "Tipe:" di struk tidak tampil; tiket dapur tidak tercetak otomatis setelah bayar.
- [ ] Tambah produk dengan modifier wajib (mis. Level Gula) → tidak bisa ditambah ke keranjang tanpa pilih modifier.
- [ ] Diskon per item & diskon transaksi (persen dan nominal) → total ikut berubah, tidak bisa melebihi subtotal.
- [ ] Cek urutan hitung: diskon → service charge → pajak → pembulatan sesuai Pengaturan → Pajak & Struk.
- [ ] Simpan sebagai Open Bill → muncul di "Pesanan Terbuka", bisa dibuka lagi.
- [ ] Bayar tunai: kalkulator kembalian benar; **uang kurang dari total ditolak** (tombol Selesaikan nonaktif).
- [ ] Bayar QRIS/transfer/kartu → transaksi selesai, struk bisa ditampilkan.
- [ ] Split bill: pisah tagihan per item, tiap bagian bisa dibayar metode berbeda.
- [ ] Klik tombol bayar dua kali cepat (double-tap) → **tidak** membuat transaksi dobel / stok tidak berkurang dua kali.
- [ ] Void transaksi (dari Riwayat, butuh PIN supervisor) → stok kembali, tercatat di Log Aktivitas.
- [ ] Retur sebagian item → stok item itu saja yang kembali, order tetap `paid` (bukan dihapus).

## 3. Meja & Dapur (KDS)

*(lewati bila Jenis Usaha = Minimarket)*

- [ ] Tambah meja baru → langsung muncul di Denah Meja, status "Tersedia".
- [ ] Ketuk meja kosong → mulai pesanan; ketuk meja terisi → panel kelola (pindah/gabung/tandai bersih).
- [ ] Siklus status meja: tersedia → terisi → menunggu pembayaran → perlu dibersihkan → tersedia lagi (otomatis kecuali langkah terakhir, manual oleh staf).
- [ ] Coba hapus meja **baru & belum pernah dipakai** → berhasil, tombol Hapus aktif.
- [ ] Coba hapus meja **yang pernah dipakai transaksi** → tombol Hapus nonaktif + alasan tampil sebelum ditekan (bukan gagal setelah konfirmasi).
- [ ] "Susun Denah" → drag posisi meja, posisi tersimpan setelah reload.
- [ ] Dapur: tandai item Baru → Diproses → Siap → Selesai, badge waktu berjalan.
- [ ] Order dengan >1 tiket (tambah item setelah tiket pertama tercetak) → tiket ke-2 tercetak terpisah, bukan cetak ulang semua.

## 4. Pager TD157 (Mode Manual) ⚠ HW

Lihat `PAGER-RETEKESS.md` untuk detail. Base station **tidak** dicolok ke tablet (mode Manual tanpa kabel).

- [ ] Pengaturan → Pager → Jenis pager = **Manual**, Nomor pager maks. = jumlah coaster TD157 fisik.
- [ ] Simpan → tidak ada opsi "Tes panggil" muncul (memang tidak ada yang bisa dites di mode ini).
- [ ] Tandai semua item sebuah order "Siap" di Dapur → badge oranye **"Panggil manual coaster #N di keypad"** muncul di kartu order.
- [ ] Pencet nomor N itu di keypad transmitter TD157 → coaster fisik nomor N berbunyi.
- [ ] Buat pesanan melebihi jumlah coaster fisik (mis. semua coaster sedang dipegang order lain) → badge "menunggu coaster (semua dipakai)" muncul, order berikutnya dapat nomor begitu satu coaster bebas (order lama diambil/selesai).
- [ ] Order selesai/diambil pelanggan → nomor coaster itu bisa dipakai order berikutnya (didaur ulang).

## 5. Printer Struk & Dapur ⚠ HW

Lihat `PRINTER.md` untuk setup lengkap.

- [ ] Cetak struk lewat printer **Bluetooth** — hasil cetak rapi, lebar kertas (58/80mm) sesuai setelan.
- [ ] Cetak struk lewat printer **WiFi/LAN** (host:port) — sama seperti di atas.
- [ ] Tiket dapur tercetak otomatis ke printer dapur, terpisah dari printer kasir.
- [ ] **Matikan printer**, coba cetak → gagal dalam **~3 detik** dengan pesan jelas ("printer tidak merespons"), **bukan macet/hang tanpa batas**. Job masuk antrean cetak untuk di-retry.
- [ ] Nyalakan lagi printer → retry dari Antrean Cetak (`/cetak`) berhasil.
- [ ] Cabut daya printer **di tengah** proses cetak → aplikasi tetap responsif, bukan freeze.

## 6. Shift & Kas

- [ ] Tutup shift dengan open bill masih ada → **ditolak**, harus diselesaikan/dibatalkan dulu.
- [ ] Tutup shift dengan kas fisik kurang/lebih dari sistem → selisih tampil & tercatat.
- [ ] Selisih di atas toleransi (Pengaturan) → butuh PIN supervisor untuk lanjut tutup shift.
- [ ] Blind close aktif → kasir tidak melihat "kas seharusnya" sebelum input hitungan fisik selesai.
- [ ] Kas Masuk / Kas Keluar tercatat & mempengaruhi kas seharusnya saat tutup shift.

## 7. Stok & Inventori

*(lewati resep/produksi bila Jenis Usaha = Minimarket)*

- [ ] Produk dengan resep (BOM) → stok **bahan baku** berkurang saat terjual, bukan stok produk jadi.
- [ ] Stock opname: input hitungan fisik → selisih vs stok tercatat otomatis dihitung saat difinalisasi.
- [ ] Pembelian (Purchase) `draft` → `received` → stok bahan/produk bertambah otomatis.
- [ ] Produksi: input bahan terpakai → output barang jadi, stok kedua sisi ter-update.
- [ ] Minimarket: scan barcode produk di Kasir → produk langsung masuk keranjang.

## 8. Laporan

- [ ] Buka Laporan hari ini setelah 1+ transaksi → Omzet, Jumlah Transaksi, Laba Kotor (HPP terpotong) sesuai.
- [ ] Produk Terlaris, Penjualan per Kategori/Kasir/Metode Pembayaran terisi benar.
- [ ] Ekspor CSV dan PDF → berkas terunduh, isinya cocok dengan tampilan layar.
- [ ] Ganti rentang tanggal (preset & kustom) → angka berubah sesuai rentang, terkunci ke zona waktu Asia/Jakarta.

## 9. Pemesanan Mandiri via QR

*(hanya bila Jenis Usaha = Kafe & Restoran / Kantin; butuh backend aktif)*

- [ ] Buat QR meja di Pengaturan → Meja & QR, cek peringatan bila `qrOrderBaseUrl` belum diisi/tidak bisa dibuka pelanggan.
- [ ] Buka link QR dari HP **terpisah** (bukan tablet kasir) → menu tampil dengan nama usaha, kategori, item.
- [ ] **Matikan/putuskan backend** lalu buka link QR → pesan error jelas ("Server pesanan tidak dapat dihubungi..."), **bukan layar putih/crash**.
- [ ] Kirim pesanan dari HP pelanggan → muncul di tablet kasir sebagai "Pesanan QR" menunggu, dengan bunyi lonceng.
- [ ] Terima pesanan → dapat nomor antrean, tiket ke dapur; Tolak → alasan wajib diisi, pelanggan melihatnya.
- [ ] Panggil pramusaji / minta tagihan dari HP pelanggan → muncul di layar Pesanan QR.

## 10. Sinkronisasi Multi-Perangkat

*(hanya bila backend dikonfigurasi)*

- [ ] Pengaturan → Sinkronisasi → isi URL + kunci perangkat → "Uji Koneksi" hijau.
- [ ] Transaksi di **tablet A** (online) → muncul di **tablet B** dalam <1 menit (atau setelah sync manual).
- [ ] **Putuskan internet tablet A**, buat transaksi, sambungkan lagi → transaksi tersinkron, muncul **tepat satu kali** di tablet B (tidak dobel).
- [ ] Tekan "Sinkronkan Sekarang" berkali-kali → state server tidak berubah/dobel (idempoten).
- [ ] Transaksi yang sudah `paid` di server → **tidak pernah** kembali jadi `open` meski disinkron ulang dari perangkat lain.

## 11. Fitur Keandalan (baru)

- [ ] Pengaturan → Tentang → baris "Penyimpanan data" tampil ("Terkunci" atau "Belum terkunci" sesuai dukungan browser/OS).
- [ ] Install sebagai PWA/APK di tablet nyata → cek baris ini idealnya "Terkunci" (indikasi data aman dari penghapusan otomatis OS saat storage penuh).
- [ ] Simulasikan jam Android dimundurkan cukup jauh lalu buka app lagi → badge merah **"Jam perangkat mundur"** muncul di header (untuk peran pemilik/administrator).
- [ ] Kembalikan jam ke waktu benar → badge tetap muncul sampai waktu sistem melewati titik tertinggi yang pernah tercatat (perilaku yang diharapkan, bukan bug).

## 12. Kompatibilitas Perangkat ⚠ HW

- [ ] Tablet target (10–13", landscape terkunci) → semua layar bisa dinavigasi, target sentuh ≥44px, tidak ada elemen terpotong.
- [ ] Lebar layar <760px atau orientasi potret → pesan "putar perangkat" tampil, bukan UI rusak.
- [ ] Barcode scanner (HID) → scan di Kasir dan form produk terbaca sebagai input teks.
- [ ] Kamera untuk bukti pengeluaran → foto berhasil dilampirkan.
- [ ] APK release (sideload) → instal, onboarding, transaksi, sinkron semua berjalan seperti versi web.

## 13. Regresi Cepat (sebelum tiap rilis)

Jalankan dari terminal — lihat `TEST-PLAN.md` untuk detail & angka terbaru:

```bash
npm run typecheck && npm run lint && npm test      # unit test frontend
npm run build && npm run test:e2e                  # e2e Playwright
cd backend && npm run test:with-db                 # integrasi backend + Postgres
```

Semua harus lulus **sebelum** mulai checklist manual di atas — checklist ini
menguji hal yang tidak bisa dijangkau test otomatis (hardware fisik, UX
lintas-layar, persepsi visual), bukan pengganti suite otomatis.

---

## Catatan pengujian

| Tanggal | Penguji | Perangkat | Area yang diuji | Hasil |
|---|---|---|---|---|
| | | | | |
