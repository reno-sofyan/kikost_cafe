# Kione POS

Aplikasi kasir **offline-first** untuk kafe, restoran, dan ritel kecil di Indonesia —
Bahasa Indonesia, Rupiah, zona waktu lokal. Ditujukan untuk tablet Android / monitor
touchscreen dalam mode lanskap.

Kione POS adalah produknya; **nama, logo, dan identitas usaha diisi oleh pemiliknya**
lewat Pengaturan → Profil Usaha. Identitas itulah yang muncul di layar masuk, struk,
tiket dapur, dan halaman pesanan yang dibuka pelanggan. Merek Kione hanya tampil pada
permukaan milik aplikasi: onboarding, splash, panel "Tentang", dan satu baris kredit
kecil di kaki layar masuk. Pembagian itu dijelaskan di `src/lib/brand.ts`.

- **Frontend**: React + TypeScript (strict) + Vite, PWA installable, IndexedDB (Dexie),
  Service Worker. Dibungkus **Capacitor** menjadi APK Android.
- **Backend** (opsional): Node.js + Fastify + PostgreSQL — sinkronisasi multi-perangkat,
  sumber backup, dan jalur pemesanan mandiri via QR meja.
- **Deployment**: Docker Compose, TLS via reverse proxy. Domain diatur lewat `POS_DOMAIN`
  di `deploy/.env` — lihat `docs/DEPLOYMENT.md`.

Aplikasi berjalan penuh tanpa backend; sinkronisasi dan pemesanan QR adalah lapisan
tambahan yang bisa dinyalakan belakangan.

## Kemampuan

| Area | Status |
|---|---|
| Kasir, meja & denah lantai, pembayaran (tunai/QRIS/transfer/kartu, split bill, pembayaran sebagian) | ✅ offline-first |
| Kitchen display, antrean cetak, printer browser / Bluetooth ESC-POS / WiFi-LAN | ✅ |
| Riwayat, pembatalan & retur, laporan (omzet, laba kotor/HPP, produk terlaris) | ✅ |
| Stok, BOM/resep, produksi, pembelian, stock opname, pengeluaran, pelanggan | ✅ |
| Shift & kas (blind close, toleransi selisih, persetujuan supervisor) | ✅ |
| Onboarding, login PIN + peran + audit log, auto-lock, rate limit | ✅ |
| White-label: nama + logo usaha di aplikasi, struk, dan halaman pelanggan | ✅ |
| Pemesanan mandiri pelanggan via QR meja + pembayaran QRIS online | ✅ (butuh backend) |
| Sinkronisasi multi-perangkat (push/pull, idempotency, LWW, proteksi transaksi final) | ✅ (butuh backend) |
| Pager restoran Retekess via USB-OTG | ✅ kode + test (perangkat fisik: pending) |
| Backup lokal (ekspor/impor JSON) + `pg_dump` harian di sisi server | ✅ |
| Multi-outlet | ✅ dasar (satu outlet aktif per perangkat) |

## Mulai cepat

```bash
npm install
npm run dev                       # http://localhost:5173 (lanskap, lebar > 760px)

npm run typecheck && npm run lint && npm test   # tsc + eslint + 206 unit test
npm run build && npm run test:e2e               # 17 e2e (Playwright, build produksi)

cd backend && npm install
npm run test:with-db              # Postgres ephemeral + test API

# Stack lengkap via Docker
cd deploy && cp .env.example .env.local   # sesuaikan POS_DOMAIN dsb.
docker compose -p cafe-pos-local --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

## Aset merek

Seluruh ikon, logo, splash, dan ikon peluncur Android dibangkitkan dari satu berkas:

```bash
python3 -m pip install --user pillow fonttools brotli
python3 scripts/brand/generate-assets.py
```

Geometri mark dan warnanya didefinisikan di bagian atas skrip itu, dan warnanya
harus cocok dengan `tailwind.config.ts`.

## Dokumentasi

Semua di [`docs/`](docs/README.md): arsitektur, API, deployment, rollback,
backup/restore, APK, printer, pemesanan QR, pager, panduan kasir & admin, daftar
port/container, rencana & hasil pengujian.

## Lisensi / kepemilikan

Kode dan desain orisinal milik pengembang Kione POS. POS komersial lain hanya dipakai
sebagai acuan alur kerja — tanpa menyalin merek, aset, teks, atau kode.
