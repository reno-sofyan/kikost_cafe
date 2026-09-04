# Pemesanan Mandiri via QR

Pelanggan memindai QR di meja → membuka menu di HP-nya (tanpa aplikasi, tanpa
login) → memilih item + varian + catatan + nama → **Kirim Pesanan**. Pesanan
masuk sebagai `PENDING_CONFIRMATION` di tablet kasir (dengan bunyi lonceng).
Kasir/waiter **Terima** (nomor antrean keluar, tiket dapur/bar tercetak) atau
**Tolak** (wajib alasan). Pembayaran tetap di kasir.

## Arsitektur singkat

- Halaman pelanggan = rute publik `/order/:token` di aplikasi yang sama
  (`pos.kikost.com`), **same-origin** dengan API → tidak perlu perubahan CORS.
- Backend `GET /api/t/:token` membaca katalog dari `sync_entity_state` (yang
  di-push tablet) dan **menghitung semua harga/pajak/SC/pembulatan di server**.
  Perangkat pelanggan tidak pernah dipercaya untuk angka.
- `POST /api/t/:token/orders` menulis `orders`+`orderItems` (status
  `PENDING_CONFIRMATION`, `source=qr_table`) kembali ke `sync_entity_state`;
  tablet menariknya lewat sinkronisasi biasa (poll 10 dtk).
- Token QR = string acak 32-hex (bukan id meja). Nonaktifkan → backend balas
  `410` seketika tanpa menghapus meja.
- Idempotency-Key wajib pada submit → tekan "Kirim" berulang tetap 1 pesanan.
- Rate limit publik: 40 req/menit/IP untuk menu & submit, 6/menit untuk
  panggil-waiter. Catatan pelanggan disanitasi (buang kontrol char + `<>`,
  potong 180 char). Maksimal 40 jenis item, qty 1–99 per item.

## Rilis (satu kali)

1. **Deploy**: rebuild image `cafe-pos-web` **dan** `cafe-pos-api`, lalu redeploy.
   Migrasi `002_qr_ordering.sql` jalan otomatis saat boot
   (`RUN_MIGRATIONS_ON_BOOT=true`). Tidak ada env baru yang wajib.
2. **APK**: pasang APK v10 di tablet (skema Dexie v7 — migrasi aditif otomatis,
   ambil backup manual dulu sesuai kebiasaan).
3. Di tablet: **Pengaturan → Meja & QR**
   - Cek "URL Halaman Pesan-Mandiri" = `https://pos.kikost.com` (ubah bila domain
     berbeda).
   - Tambah meja / titik ("Meja 1", "Pojok", "Bar") — bebas dinamai.
   - **Buat QR** per meja → **Unduh PNG** → cetak & tempel di meja.
4. Pastikan tablet sudah pernah online setelah update supaya katalog
   (produk/kategori/modifier/pengaturan) ter-push ke server — kalau belum,
   menu QR akan kosong.

## Operasional harian

- Pesanan QR baru → lonceng + chip "N pesanan QR menunggu" di header + menu
  **Pesanan QR** di navigasi kiri.
- **Terima**: order pindah ke `CONFIRMED`, dapat nomor antrean, langsung dikirim
  ke dapur/bar (printer gagal tidak membatalkan — job masuk antrean cetak).
- **Tolak**: wajib isi alasan; pelanggan melihatnya di halaman status.
- Panggil Waiter / Minta Tagihan dari pelanggan muncul sebagai baris di layar
  **Pesanan QR**; tekan **Selesai** setelah ditangani.
- Nonaktifkan QR sebuah meja kapan saja tanpa kehilangan data meja.

## Real-time (SSE)

Tablet membuka `GET /api/events?key=<kunci perangkat>` (SSE). Server menyiarkan
sinyal saat ada perubahan → tarik-sync seketika (pesanan QR baru muncul < 3 dtk).
Poll 20 dtk tetap jalan sebagai jaring pengaman. Tak perlu konfigurasi; melewati
Traefik seperti request `/api` lain.

## Pembayaran online (opsional)

`POST /api/payments/webhook` — generik. Adaptor gateway apa pun memetakan
notifikasinya ke `{ orderId, billId, amount, method, reference }` + header
`X-Signature` = HMAC-SHA256 hex dari string `orderId.billId.amount.reference`
memakai env **`PAYMENT_WEBHOOK_SECRET`** (kosong → endpoint 503/nonaktif).

Efek: menulis entitas `onlinePayments` (append-only, idempoten per `reference`).
**Tablet** yang menjalankan `payBill` lokal saat menariknya — potong stok,
selesaikan order — jadi jalur kasir offline tak berubah. Bila order belum
dikonfirmasi kasir, pelunasan ditunda sampai dikonfirmasi.

## Gabung pesanan meja

Bila pelanggan menambah pesanan via QR di meja yang **sudah punya pesanan aktif**,
layar Pesanan QR menampilkan tombol **"Gabung ke &lt;no pesanan&gt;"** — item pindah
ke pesanan itu, order QR di-void, item baru dikirim ke dapur.

## Harga di-lock saat submit, dihitung ulang saat diterima

Saat kasir **Terima**, tiap baris dihitung ulang dengan harga menu terkini; item
yang jadi tak tersedia dikeluarkan. Selisih ditampilkan + masuk audit log.

## Belum ada (butuh keputusan)

- Sesi meja formal + penggabungan tagihan lintas order otomatis.
- Adaptor gateway QRIS spesifik (Midtrans/Xendit/dll) — tinggal petakan ke webhook.
