# Kikost Cafe POS

Aplikasi kasir F&B **offline-first** untuk kafe keluarga (satu outlet). Bahasa Indonesia,
Rupiah, zona waktu Asia/Jakarta. Ditujukan untuk tablet Android / monitor touchscreen.

- **Frontend**: React + TypeScript (strict) + Vite, PWA installable, IndexedDB (Dexie),
  Service Worker. Bungkus **Capacitor** untuk APK Android.
- **Backend**: Node.js + Fastify + PostgreSQL — API sinkronisasi multi-perangkat + sumber backup.
- **Deployment**: Docker Compose terpisah di VPS bersama `kikost.com`, subdomain
  `pos.kikost.com`, TLS Let's Encrypt via reverse proxy.

Nama & identitas kafe diubah dari dalam aplikasi (Pengaturan). Nama awal: "Kafe Keluarga POS".

## Status

| Area | Status |
|---|---|
| Aplikasi kasir (kasir, meja, pembayaran, KDS, riwayat, retur, laporan, stok/BOM, shift, pengeluaran, pelanggan) | ✅ lengkap, offline-first |
| Onboarding, login PIN + role + audit log, auto-lock, rate limit | ✅ |
| Backend sinkronisasi (push/pull/health, idempotency, LWW, proteksi transaksi final) | ✅ + 21 test |
| Migrasi DB (runner advisory-lock, additif, rollback) | ✅ |
| Docker Compose produksi (4 container POS + opsi Traefik), resource limit, healthcheck, log rotation | ✅ divalidasi + diuji lokal |
| Backup `pg_dump` harian + retensi + restore ke DB uji | ✅ diuji end-to-end |
| Printer: adapter browser / Bluetooth ESC-POS / WiFi-LAN + mock + native plugin Android | ✅ kode + mock test (printer fisik: pending) |
| APK Android (proyek `android/`, signing config) | ✅ proyek siap (build butuh JDK+SDK di mesin build) |
| Unit/integrasi test | ✅ 53 frontend + 21 backend |
| E2E Playwright | ✅ 6 lulus (smoke + onboarding→shift→kasir); skenario transaksi penuh: sebagian |
| CI (GitHub Actions) + release image ke GHCR | ✅ |
| Deploy ke VPS + DNS `pos.kikost.com` + tanda tangan APK | ⏳ butuh akses (lihat `docs/DEPLOYMENT.md`) |

## Mulai cepat

```bash
npm install
npm run dev                       # http://localhost:5173
npm test                          # unit + integrasi (vitest)
npm run build && npm run test:e2e # e2e (playwright)

cd backend && npm install
npm run test:with-db              # Postgres ephemeral + test API

# Stack lengkap via Docker
cd deploy && cp .env.example .env.local   # sesuaikan
docker compose -p cafe-pos-local --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

## Dokumentasi

Semua di [`docs/`](docs/README.md): arsitektur, API, deployment, rollback,
backup/restore, APK, printer, panduan kasir & admin, daftar port/container, rencana &
hasil pengujian.

## Lisensi / kepemilikan

Proyek internal Kikost Cafe. Desain & kode orisinal — Accurate POS hanya dipakai sebagai
acuan alur kerja, tanpa menyalin merek, aset, teks, atau kode.
