# Standar Pencatatan Penjualan — Kione POS

Berlaku untuk **semua jenis usaha** (kafe & resto, kantin, minimarket, lainnya) dan semua
laporan: aplikasi kasir, konsol Pemilik (`/owner`), konsol operator (`/ops`), PDF, CSV, dan
ekspor jurnal akuntansi. Fitur atau laporan baru wajib mengikuti aturan di bawah.

## 1. Dasar akrual

Penjualan (omzet) dicatat pada **tanggal pesanan dibuat** (`Order.createdAt`), bukan saat
dilunasi.

| Pesanan | Diakui sebagai penjualan? | Tanggal |
|---|---|---|
| Lunas (`paid` / `completed`) | Ya | Tanggal pesanan |
| Tagihan Tertunda belum dibayar (`open` + `payLater`) | Ya — sisanya jadi **piutang** | Tanggal pesanan |
| Pesanan terbuka biasa (meja masih berjalan, belum bayar) | Belum | Diakui setelah lunas, di tanggal pesanannya |
| Batal (`void`) | Tidak | Jumlah pembatalan dihitung di **waktu batal** |

Kode acuan: `isRecognizedSale` (`src/db/repositories/reports.ts`) dan
`RECOGNIZED_SALE_SQL` / `SALE_AT_MS` (`backend/src/lib/tenantReports.ts`). Jangan menulis
ulang aturan ini di tempat lain — pakai helper tersebut.

## 2. Piutang

- **Piutang** = bagian penjualan yang belum dibayar = `grandTotal` − pembayaran positif
  (pembayaran sebagian dikurangkan; pembalikan/`reversalOfPaymentId` tidak dihitung).
- Ditampilkan sebagai **"Belum dibayar (piutang)"** di Laporan Penjualan, `/owner`, dan PDF.

## 3. Pelunasan piutang

Pembayaran yang diterima di **hari lain** (WIB) dari tanggal pesanannya — mis. dibuka
tgl 29, dilunasi tgl 30 — tampil terpisah sebagai **"Pelunasan piutang"** pada periode
pembayarannya, lengkap dengan No. pesanan, tanggal pesanan, waktu lunas, metode, dan nilai.
Itu uang masuk, **bukan omzet** periode pelunasan.

Di ringkasan shift, pelunasan = pesanan yang dibuat **sebelum shift dibuka** dan dilunasi
di shift itu.

## 4. Shift & kas laci

Shift mencatat **penerimaan** (uang masuk) menurut **waktu bayar** — supaya cocok dengan
uang fisik di laci. Labelnya "Penerimaan", bukan "Penjualan/Omzet". Pesanan yang terbawa
dari shift tertutup atau tagihan tertunda masuk ke shift saat dilunasi (`payBill`).

## 5. Jurnal akuntansi

| Kejadian | Jurnal | Tanggal |
|---|---|---|
| Penjualan dibayar di hari yang sama | Debit Kas/Bank, Kredit Penjualan (+ pajak, SC, diskon) | Tanggal pesanan |
| Penjualan belum/tidak dibayar di hari itu | Debit **1-10101 Piutang Usaha**, Kredit Penjualan | Tanggal pesanan |
| Pelunasan di hari lain | Debit Kas/Bank, Kredit Piutang Usaha | Tanggal bayar |

## 6. Istilah di layar

| Istilah | Arti |
|---|---|
| Omzet | Penjualan diakui (akrual), menurut tanggal pesanan |
| Belum dibayar (piutang) | Bagian omzet yang uangnya belum diterima |
| Pelunasan piutang | Uang masuk untuk pesanan dari tanggal/shift lain |
| Penerimaan | Uang yang diterima per shift (kas & non-tunai) |

Setiap laporan menampilkan catatan singkat dasar pencatatan ini agar pembaca tahu cara
angkanya dihitung.
