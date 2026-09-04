# Deployment via Coolify — pos.kikost.com

> Stack POS berdiri sendiri sebagai **resource Coolify tersendiri**. Tidak menyentuh
> resource `kikost.com` (app./api./booking.) maupun konfigurasi Coolify global.

## Status prasyarat (2026-08-31)

| Item | Status |
|---|---|
| DNS `A pos.kikost.com → 76.13.180.150` (TTL 300) | ✅ **dibuat & resolve publik** (via Hostinger DNS MCP) |
| VPS 1582820 — Ubuntu 24.04 + Coolify, `running` | ✅ terverifikasi |
| Coolify dashboard `https://coolify.kikost.com` + `GET /api/health` | ✅ reachable (`OK`) |
| Firewall 80/443/22 terbuka, dipegang Coolify | ✅ tidak perlu diubah |
| Coolify API token (scope deploy) | ⛔ **dibutuhkan** — lihat §1 |
| Android release keystore | ⛔ terpisah, lihat `ANDROID-APK.md` |

## 1. Bikin Coolify API token (butuh pemilik)

Coolify UI → **Keys & Tokens → API tokens → Create New Token**
- Permissions: minimal `write` (butuh `deploy`); `root` juga boleh.
- Simpan token. Berikan lewat env saat menjalankan langkah otomatis:
  `export COOLIFY_TOKEN=...` (base URL: `https://coolify.kikost.com`).

Tanpa token, ikuti jalur UI di §3.

## 2. Sumber & konfigurasi resource

- **Type**: Docker Compose (sumber: Git repository ini)
- **Branch**: `main` (setelah `build/pos-backend-deploy-tests` di-merge) — atau branch itu langsung
- **Base directory**: `/`
- **Docker Compose file**: `deploy/docker-compose.yml` (dipakai apa adanya; sudah
  divalidasi `docker compose config` dengan `PROXY_NETWORK=coolify`)
- **Build**: Coolify build image `cafe-pos-api` & `cafe-pos-web` dari repo
  (context `../backend` dan `..` relatif terhadap `deploy/` — valid saat clone penuh).

### Environment variables (set di Coolify, tandai *Build Variable* untuk yang dipakai saat build bila perlu)

```
POS_DOMAIN=pos.kikost.com
PROXY_NETWORK=coolify
TRAEFIK_HTTPS_ENTRYPOINT=https
TRAEFIK_CERTRESOLVER=letsencrypt
POSTGRES_USER=cafe_pos
POSTGRES_DB=cafe_pos
POSTGRES_PASSWORD=<openssl rand -hex 24>
SYNC_DEVICE_KEYS=<openssl rand -hex 32>[,<kunci tablet ke-2>...]
CORS_ORIGINS=https://pos.kikost.com
RUN_MIGRATIONS_ON_BOOT=true
BACKUP_CRON=15 18 * * *
BACKUP_RETENTION_DAYS=14
# Off-site backup (disarankan) — S3-kompatibel (B2/R2/Wasabi/AWS/MinIO):
# BACKUP_S3_BUCKET=... BACKUP_S3_ACCESS_KEY=... BACKUP_S3_SECRET_KEY=...
# BACKUP_S3_ENDPOINT=https://...   (wajib non-AWS)
# Pembayaran online QRIS/gateway (opsional):
# PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 24>
# batas resource sudah default di compose (PG 512M / API 384M / web 128M)
```

## 3. Jalur UI (tanpa token)

1. Coolify → project **baru** (mis. `cafe-pos`), environment `production`.
   JANGAN pakai project yang memuat resource kikost.
2. **+ New Resource → Docker Compose → Based on a Git Repository**.
   Hubungkan repo, isi Branch / Base directory / Compose file seperti §2.
3. Tab **Environment Variables**: tempel blok di §2 (isi rahasia asli).
4. Tab **Domains**: untuk service `cafe-pos-web` → `https://pos.kikost.com`;
   untuk `cafe-pos-api` → `https://pos.kikost.com/api`.
   (Bila memakai label Traefik bawaan compose, biarkan Domains kosong — label sudah
   merutekan Host + PathPrefix `/api`. Pilih SALAH SATU, jangan dua-duanya.)
5. **Deploy**. Pantau log build. Let's Encrypt terbit otomatis untuk `pos.kikost.com`
   (DNS sudah mengarah ke VPS).

## 4. Jalur API (dengan token) — dijalankan asisten

Endpoint Coolify v4 (`https://coolify.kikost.com/api/v1`, header `Authorization: Bearer $COOLIFY_TOKEN`):

1. `GET /servers` → ambil `uuid` server lokal.
2. `GET /projects` → pastikan tak ada tabrakan; `POST /projects` `{name:"cafe-pos"}`.
3. `POST /applications/dockercompose` (atau `/services`) dengan:
   `project_uuid`, `server_uuid`, `environment_name:"production"`,
   `git_repository`, `git_branch`, `base_directory:"/"`,
   `docker_compose_location:"/deploy/docker-compose.yml"`.
4. `POST /applications/{uuid}/envs` (bulk) → variabel §2.
5. `POST /deploy?uuid={uuid}` → trigger; poll `GET /deployments/{uuid}`.

> Nama endpoint pasti bisa berubah antar versi Coolify — asisten akan menyesuaikan
> dari respons error API yang sebenarnya.

## 5. Verifikasi pasca-deploy

```bash
curl -s https://pos.kikost.com/api/health          # {"status":"ok","db":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' https://pos.kikost.com/   # 200
```

- [ ] `kikost.com` (app./api./booking.) tetap normal — cek terpisah
- [ ] resource & network Coolify milik kikost tidak berubah
- [ ] sertifikat `pos.kikost.com` valid, PWA installable
- [ ] `/api/health` ok, DB ok
- [ ] container `cafe-pos-*` healthy, dalam batas resource
- [ ] backup pertama tertulis (`cafe-pos-backup` → `/backups/`)
- [ ] APK di tablet bisa login + uji offline/sync (`TEST-PLAN.md`)

## 6. Update berikutnya

Push ke branch → Coolify auto-deploy (bila webhook diaktifkan) atau tekan **Deploy**.
Hanya resource POS yang di-recreate. Reverse proxy & resource kikost tak tersentuh.

## Catatan isolasi

- PostgreSQL POS tanpa `ports:` → hanya di network internal `cafe-pos-internal`.
- Volume berawalan `cafe-pos-` (`cafe-pos-pgdata`, `cafe-pos-backups`).
- Hanya `cafe-pos-web` & `cafe-pos-api` menempel ke network `coolify` (proxy).
- Tak ada perubahan firewall, tak ada port host baru.
