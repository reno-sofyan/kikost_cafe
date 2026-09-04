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

---

## 8. Rilis fitur QR + Fase 3 (redeploy backend) — SATU KALI

Backend live `pos.kikost.com` saat ini masih build lama (hanya `/api/sync`).
Fitur **pesanan QR, SSE real-time, webhook pembayaran online, kelola perangkat,
struk digital, rem auth** butuh redeploy dari `main`.

### 8a. Env (set di Coolify → Environment Variables, atau `deploy/.env` bila manual)

Sudah ada, **tidak diubah**: `POS_DOMAIN`, `PROXY_NETWORK`, `POSTGRES_*`,
`SYNC_DEVICE_KEYS`, `CORS_ORIGINS`, `RUN_MIGRATIONS_ON_BOOT=true`, `BACKUP_*`.

Baru — **opsional**, isi hanya yang dipakai:

```
# Backup off-site (SANGAT disarankan) — S3-kompatibel:
BACKUP_S3_BUCKET=<nama-bucket>
BACKUP_S3_ACCESS_KEY=<key>
BACKUP_S3_SECRET_KEY=<secret>
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com   # WAJIB non-AWS (B2/R2/Wasabi/MinIO)
# BACKUP_S3_PROVIDER=Backblaze     # Backblaze|Cloudflare|Wasabi|AWS|Minio|Other
# BACKUP_S3_REGION=us-west-004
# BACKUP_S3_PREFIX=cafe-pos

# Pembayaran online QRIS/gateway (opsional — tanpa ini, bayar di kasir seperti biasa):
PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 24>
```

**Tidak perlu** perubahan `CORS_ORIGINS` — halaman pelanggan `/order/:token`
disajikan same-origin dengan `/api`.

### 8b. Redeploy

- **Coolify**: buka resource `cafe-pos` → **Redeploy** (rebuild `cafe-pos-api` +
  `cafe-pos-web` dari `main`). Migrasi `002_qr_ordering.sql` jalan otomatis saat
  API boot (advisory-lock, aditif).
- **Manual (SSH ke VPS)**:
  ```bash
  cd /opt/apps/cafe-pos && git pull
  cd deploy && ./scripts/deploy.sh
  ```

### 8c. Verifikasi (dari mana saja)

```bash
curl -s https://pos.kikost.com/api/health                              # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' https://pos.kikost.com/api/events            # 401 (bukan 404)
curl -s -o /dev/null -w '%{http_code}\n' https://pos.kikost.com/api/t/0000000000000000  # 404 JSON "Kode QR tidak dikenal" (bukan 404 HTML)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://pos.kikost.com/api/payments/webhook  # 503 (belum ada secret) atau 400
```

`/api/events` = **401** berarti build baru sudah live. Masih **404** = redeploy belum jalan.

### 8d. Tablet

1. Pasang **APK v15** (menimpa versi lama, signature sama).
2. Pengaturan → Sinkronisasi → pastikan tersambung (chip "Online").
3. Biarkan online beberapa menit → katalog ter-push ke server (produk, kategori,
   modifier, pengaturan, outlet). **Wajib** sebelum QR dipakai — kalau tidak, menu QR kosong.
4. Pengaturan → **Meja & QR** → cek URL `https://pos.kikost.com` → tambah meja →
   **Buat QR** → **Unduh PNG** → cetak & tempel di meja.
5. Uji: buka `https://pos.kikost.com/order/<token>` di HP lain → menu tampil →
   kirim pesanan → muncul di layar **Pesanan QR** tablet (dengan bunyi).

### 8e. Backup off-site (kalau diisi di 8a)

```bash
# di VPS / Coolify exec ke container backup
docker compose -p cafe-pos exec cafe-pos-backup sh /usr/local/bin/backup.sh
# cek log → harus muncul "[backup] off-site sukses"
```

### 8f. Gateway pembayaran online (kalau dipakai)

Arahkan notifikasi sukses gateway ke `POST https://pos.kikost.com/api/payments/webhook`
dengan body `{ orderId, billId, amount, method, reference }` + header
`X-Signature: <HMAC-SHA256 hex dari "orderId.billId.amount.reference" pakai PAYMENT_WEBHOOK_SECRET>`.
Umumnya butuh fungsi adaptor kecil (Cloud Function / route) yang menerjemahkan
webhook provider (Midtrans/Xendit/dll) ke bentuk ini. Lihat `docs/QR-ORDERING.md`.
