# Dokumentasi Kikost Cafe POS

Aplikasi kasir F&B offline-first untuk kafe keluarga (satu outlet). PWA + APK Android,
backend Node.js/Fastify + PostgreSQL, deployment Docker Compose terpisah di VPS bersama
`kikost.com` pada subdomain `pos.kikost.com`.

## Indeks

| Dokumen | Isi |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gambaran arsitektur, alur data, model sinkronisasi |
| [API.md](API.md) | Kontrak API sinkronisasi (ringkas); spec penuh: `backend/openapi.yaml` |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Pemeriksaan VPS + langkah deploy tanpa mengganggu Kikost |
| [ROLLBACK.md](ROLLBACK.md) | Prosedur rollback container & data |
| [BACKUP-RESTORE.md](BACKUP-RESTORE.md) | Backup harian, retensi, uji restore |
| [ANDROID-APK.md](ANDROID-APK.md) | Build APK release, pemasangan di tablet |
| [PRINTER.md](PRINTER.md) | Konfigurasi printer thermal & pengujian hardware |
| [PORTS-CONTAINERS.md](PORTS-CONTAINERS.md) | Daftar container, port, volume, network |
| [TEST-PLAN.md](TEST-PLAN.md) | Daftar pengujian + hasil + item yang butuh hardware fisik |
| [GUIDE-KASIR.md](GUIDE-KASIR.md) | Panduan penggunaan harian untuk kasir |
| [GUIDE-ADMIN.md](GUIDE-ADMIN.md) | Panduan administrator (produk, pengguna, laporan, backup) |
| [VPS-PRECHECK.md](VPS-PRECHECK.md) | Cara menjalankan & membaca `deploy/scripts/vps-inspect.sh` |
| [vps-recon-2026-08-30.md](vps-recon-2026-08-30.md) | Hasil pemeriksaan VPS via API Hostinger (Coolify, resource, firewall, DNS) |

## Ringkasan repositori

```
.
├── src/                    # Frontend React/TS (PWA, offline-first)
├── backend/                # API Fastify + PostgreSQL (sinkronisasi & backup)
│   ├── migrations/         # Migrasi SQL (runner sendiri, advisory-lock)
│   └── openapi.yaml        # Spesifikasi API
├── deploy/                 # Docker Compose produksi + skrip deploy/rollback/backup
│   ├── docker-compose.yml
│   ├── docker-compose.local.yml    # override uji lokal
│   ├── docker-compose.traefik.yml  # opsional: bila VPS belum punya reverse proxy
│   ├── backup/             # backup.sh / restore.sh / entrypoint.sh
│   └── scripts/            # vps-inspect.sh, deploy.sh, rollback.sh
├── Dockerfile              # image web (nginx + build Vite)
└── docs/
```

## Alur kerja pengembangan

```bash
# Frontend
npm install
npm run dev            # http://localhost:5173
npm test               # 39 unit test (vitest)
npm run typecheck && npm run lint && npm run build

# Backend
cd backend && npm install
npm run test:with-db   # menjalankan Postgres ephemeral + 21 test
npm run dev            # butuh backend/.env dengan DATABASE_URL

# Stack lengkap lokal (Docker)
cd deploy
cp .env.example .env.local   # sesuaikan
docker compose -p cafe-pos-local --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml up -d --build
# web  → http://localhost:8080
# api  → http://localhost:8081/api/health
```
