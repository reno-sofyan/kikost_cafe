# Panduan Kasir

## Masuk

1. Pilih nama Anda, masukkan **PIN**.
2. Setelah 5 PIN salah, aplikasi terkunci 30 detik.
3. Layar terkunci otomatis setelah diam beberapa menit (atur di Pengaturan) — masukkan
   PIN lagi untuk lanjut. Tekan ikon gembok kiri bawah untuk mengunci manual.

## Buka shift (wajib sebelum transaksi)

**Shift → Buka Shift** → masukkan **modal awal** (uang laci). Tanpa shift terbuka,
transaksi tidak bisa diselesaikan.

- **Kas Masuk / Kas Keluar**: catat setiap uang yang masuk/keluar laci di luar penjualan.

## Membuat pesanan

1. **Kasir** → pilih tipe: **Dine-in / Takeaway / Delivery**.
2. Dine-in: pilih **meja** & jumlah tamu. Takeaway/Delivery: nomor antrean otomatis.
3. (Opsional) pilih **pelanggan**.
4. Ketuk produk pada grid. Cari lewat kotak pencarian atau **scan barcode**.
5. Produk dengan modifier (Ukuran, Level Gula, Level Es, Topping, Kepedasan) membuka
   pemilih — modifier wajib harus dipilih. Harga keranjang otomatis menyesuaikan.
6. Ubah **jumlah**, tambah **catatan**, atau **diskon per item** (butuh izin diskon).
7. **Diskon transaksi**: tombol diskon di ringkasan (persen atau nominal).
8. Pajak, service charge, dan pembulatan dihitung otomatis.

- **Simpan (Open Bill)**: simpan pesanan tanpa bayar (mis. dine-in berjalan).
  Buka lagi dari **Open Bills**.
- Mengosongkan keranjang minta konfirmasi.
- Tombol bayar terkunci sesaat setelah diklik → tidak ada transaksi dobel.

## Meja

**Meja** menampilkan denah: hijau = kosong, terisi, kuning = menunggu bayar,
biru = perlu dibersihkan. Dari detail meja: pindah meja, gabung tagihan, pisah tagihan,
tandai sudah dibersihkan.

## Pembayaran

Tekan **Bayar**:

- **Tunai** — masukkan nominal (atau tombol nominal cepat), kembalian otomatis.
  Tidak bisa lanjut bila uang kurang dari total.
- **QRIS** — tampilkan QRIS kafe ke pelanggan, tunggu notifikasi masuk di HP kafe,
  lalu tekan **Konfirmasi Pembayaran** (manual). Isi referensi bila perlu.
- **Transfer / Kartu** — konfirmasi manual, isi referensi.
- **Split** — tambah beberapa metode; total pembayaran harus sama dengan total tagihan.

Setelah berhasil: struk tercetak/tersimpan, stok berkurang, meja jadi "perlu dibersihkan",
layar transaksi berhasil muncul — langsung bisa mulai transaksi berikutnya.

## Struk

- **Cetak ulang**: Riwayat → pilih transaksi → Cetak Ulang.
- **Simpan PDF**: dari pratinjau struk.
- **Tes cetak**: minta admin (menu Pengaturan → Printer).

## Riwayat, pembatalan, retur

- **Riwayat**: cari & filter per tanggal / kasir / metode bayar. Buka detail untuk
  lihat item, pembayaran, cetak ulang.
- **Batalkan transaksi**: butuh **PIN supervisor** + alasan wajib. Stok dikembalikan
  bila transaksi sudah dibayar. Transaksi tidak dihapus, hanya ditandai batal.
- **Retur** (sebagian / seluruh): butuh PIN supervisor + alasan. Pilih apakah stok
  dikembalikan. Semua tindakan tercatat di audit log.

## Pengeluaran

**Pengeluaran** → kategori, nominal, catatan, (opsional) foto bukti. Masuk ke laporan
shift & harian.

## Dapur (KDS)

**Dapur** menampilkan pesanan masuk otomatis. Ubah status: **Baru → Diproses → Siap →
Selesai**. Ada waktu tunggu, modifier, catatan, notifikasi suara. Item yang dibatalkan
tetap tampil sebagai catatan.

## Tutup shift

**Shift → Tutup Shift**:

1. Tidak boleh ada **open bill** yang tersisa — selesaikan atau batalkan dulu.
2. Masukkan **kas aktual** yang dihitung di laci.
3. Aplikasi menampilkan kas seharusnya & **selisih**.
4. Cetak **laporan shift**.

## Status koneksi (pojok atas)

- **Online** — tersambung, sinkron berjalan.
- **Offline** — internet putus. **Transaksi tetap bisa dibuat & dibayar**; data
  tersimpan di tablet.
- **Menyinkronkan** — sedang mengirim/menerima data.
- **Gagal Sinkron** — ada data belum terkirim; tekan **Sinkronkan Sekarang** di
  Pengaturan → Sinkronisasi. Data tidak hilang; akan terkirim saat online lagi.
