# Deployment — pos.kikost.com (VPS bersama Kikost)

> **Aturan mutlak**: jangan menyentuh container/volume/network/DB milik `kikost.com`.
> Stack POS berdiri sendiri sebagai Docker Compose project `cafe-pos`.

## 0. Prasyarat yang butuh tindakan pemilik

Selesaikan semua bagian lain lebih dulu; yang berikut memerlukan akses/keputusan Anda:

1. **DNS** — buat A record `pos.kikost.com` → IP VPS (sama dengan `kikost.com`).
2. **Akses SSH** ke VPS (user dengan izin `docker`).
3. **Reverse proxy** — konfirmasi apakah VPS sudah memakai Traefik / Nginx Proxy Manager
   untuk `kikost.com`, dan nama docker network-nya.
4. **APK signing** — keystore release untuk menandatangani APK (lihat `ANDROID-APK.md`).

## 1. Pemeriksaan VPS (READ-ONLY, wajib)

```bash
scp deploy/scripts/vps-inspect.sh user@vps:/tmp/
ssh user@vps 'bash /tmp/vps-inspect.sh' | tee docs/vps-report-$(date +%F).txt
```

Skrip **tidak mengubah apa pun**. Baca bagian "Ringkasan keputusan" di akhir output.
Simpan laporannya. Bila ada risiko mengganggu Kikost (disk hampir penuh, RAM mepet,
port 80/443 dipakai selain reverse proxy, dll) → **hentikan bagian deploy**, laporkan,
lanjutkan dulu development/test/build/image.

Poin kritis yang harus lolos:

- Ada network reverse proxy yang bisa dibagi (mis. `proxy`) **atau** VPS belum punya
  reverse proxy sama sekali (maka pakai `docker-compose.traefik.yml`).
- Disk bebas > 5 GB, inode cukup.
- RAM bebas cukup untuk ± 1 GB (PG 512M + API 384M + web 128M + backup 128M).
- Tidak ada container/volume/network bernama `cafe-pos-*`.

## 2. Siapkan direktori aplikasi (terpisah)

```bash
ssh user@vps
sudo mkdir -p /opt/apps/cafe-pos
sudo chown "$USER" /opt/apps/cafe-pos
cd /opt/apps/cafe-pos
git clone <repo-url> .          # atau rsync isi repo
cp deploy/.env.example deploy/.env
```

Isi `deploy/.env`:

```bash
# rahasia — buat baru, jangan pakai punya Kikost
openssl rand -hex 24   # -> POSTGRES_PASSWORD
openssl rand -hex 32   # -> SYNC_DEVICE_KEYS (satu per tablet, pisah koma)
```

Set `POS_DOMAIN=pos.kikost.com`, `PROXY_NETWORK=<nama network proxy>`,
`TRAEFIK_CERTRESOLVER=<certresolver Let's Encrypt yang ada>`.

## 3a. Bila VPS SUDAH punya reverse proxy

Stack POS otomatis menempel ke `PROXY_NETWORK` lewat label Traefik (lihat
`deploy/docker-compose.yml`). Tidak ada perubahan pada proxy yang sudah ada.

Jika proxy-nya **Nginx Proxy Manager** (bukan Traefik): abaikan label Traefik,
buat Proxy Host di UI NPM:
`pos.kikost.com` → `cafe-pos-web:80` (forward), dan location `/api` → `cafe-pos-api:8080`,
request SSL Let's Encrypt. Pastikan `cafe-pos-web`/`cafe-pos-api` ikut network NPM
(`PROXY_NETWORK`).

## 3b. Bila VPS BELUM punya reverse proxy

Hanya jika benar-benar tidak ada yang memegang 80/443:

```bash
cd /opt/apps/cafe-pos/deploy
echo "ACME_EMAIL=admin@kikost.com" >> .env
docker compose -p cafe-pos-proxy --env-file .env -f docker-compose.traefik.yml up -d
```

## 4. Build image (di luar jam operasional)

Build berat sebaiknya tidak di jam ramai. Dua opsi:

- **Build di VPS** saat sepi:
  ```bash
  cd /opt/apps/cafe-pos/deploy
  ./scripts/deploy.sh            # build + migrate + up, hanya container POS
  ```
- **Build via GitHub Actions** (`.github/workflows/ci.yml` + workflow release) lalu:
  ```bash
  # set API_IMAGE / WEB_IMAGE di .env ke tag registry
  ./scripts/deploy.sh --pull
  ```

`deploy.sh`:
- memvalidasi `docker compose config`;
- menyimpan snapshot versi image ke `.rollback/` untuk rollback;
- menjalankan `backup.sh` sebelum perubahan;
- `docker compose up -d --no-deps` **hanya** service `cafe-pos-*`;
- menunggu `/api/health` hijau; gagal → instruksi rollback.

Migrasi dijalankan otomatis saat container API boot (advisory-lock, additif).
Nonaktifkan dengan `RUN_MIGRATIONS_ON_BOOT=false` bila ingin manual (`npm run migrate`).

## 5. Verifikasi pasca-deploy

```bash
curl -s https://pos.kikost.com/api/health          # {"status":"ok","db":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' https://pos.kikost.com/   # 200
docker compose -p cafe-pos ps                       # semua (healthy)
docker compose -p cafe-pos exec cafe-pos-backup sh /usr/local/bin/backup.sh
```

Checklist "deployment berhasil":

- [ ] `kikost.com` tetap normal (cek terpisah, tidak disentuh proses ini)
- [ ] container & volume Kikost tidak berubah
- [ ] `https://pos.kikost.com` bisa diakses, sertifikat valid
- [ ] PWA installable (Chrome → Install)
- [ ] `/api/health` ok, DB ok
- [ ] semua container `cafe-pos-*` healthy, resource dalam limit
- [ ] backup pertama berhasil (`/backups/cafe-pos-latest.sql.gz` ada)
- [ ] APK terpasang di tablet & bisa login (lihat `ANDROID-APK.md`)
- [ ] uji offline + sinkronisasi (lihat `TEST-PLAN.md` alur E2E)

## 6. Update berikutnya (tanpa downtime Kikost)

```bash
cd /opt/apps/cafe-pos && git pull
cd deploy && ./scripts/deploy.sh          # atau --pull
```

Hanya container POS yang direcreate. Reverse proxy & Kikost tidak disentuh.

## Keamanan operasional

- `deploy/.env` mode `600`, tidak pernah di-commit.
- PostgreSQL POS tanpa `ports:` → tak terjangkau dari internet/host.
- Rate limit API (`RATE_LIMIT_MAX`), CORS dibatasi (`CORS_ORIGINS`).
- Log rotasi: json-file `max-size=10m max-file=5` per container.
- Jangan mengubah firewall Kikost. Buka port hanya lewat reverse proxy yang ada.
