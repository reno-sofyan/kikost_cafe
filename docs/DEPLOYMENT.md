# Deployment — pos.kikost.com (VPS bersama Kikost)

> **Aturan mutlak**: jangan menyentuh container/volume/network/DB milik `kikost.com`
> maupun Coolify. Stack POS berdiri sendiri sebagai Docker Compose project `cafe-pos`.

## Kondisi VPS (terverifikasi via API Hostinger, 2026-08-30)

| Item | Nilai | Implikasi |
|---|---|---|
| VPS | id `1582820`, **KVM 4** — 4 vCPU / 16 GB RAM / 200 GB disk | Headroom besar |
| IP | `76.13.180.150` (IPv6: `2a02:4780:5e:bde1::1`) | target A record `pos` |
| OS/Platform | **Ubuntu 24.04 + Coolify** | Reverse proxy = Traefik milik Coolify (`coolify-proxy`), network `coolify` |
| Beban 24 jam | CPU ~5.5%, RAM ~1.7 GB terpakai | Sangat lega untuk +~1 GB stack POS |
| Disk (metrik API) | ~8.6 GB (ambigu: perlu `df -h` untuk pastikan free vs used) | **Konfirmasi manual sebelum deploy** |
| Firewall "KIKOST production" | SSH 22, HTTP 80, HTTPS 443 (TCP+UDP) → any | 80/443 sudah dipegang Coolify. **Tidak perlu ubah firewall** — POS tak buka port baru |
| DNS `kikost.com` | dikelola Hostinger; `@ www app api booking coolify dashboard` → VPS | tambah `A pos → 76.13.180.150` |

## 0. Prasyarat yang butuh tindakan / akses pemilik

1. **DNS** — tambah `A pos → 76.13.180.150` pada zona `kikost.com`
   (via MCP `hostinger-dns`, panel Hostinger, atau Coolify UI). TTL default.
2. **Akses ke VPS** — SSH (user grup `docker`) **atau** akses Coolify UI + Coolify API token.
3. **APK signing** — keystore release (lihat `ANDROID-APK.md`).

## 1. Pemeriksaan VPS (READ-ONLY, wajib sebelum deploy)

Via SSH:

```bash
scp deploy/scripts/vps-inspect.sh user@76.13.180.150:/tmp/
ssh user@76.13.180.150 'bash /tmp/vps-inspect.sh' | tee docs/vps-report-$(date +%F).txt
```

Skrip **tidak mengubah apa pun**. Yang wajib dikonfirmasi (melengkapi data API di atas):

- `df -h /` → **disk free > 5 GB** (metrik API ambigu — ini yang menentukan).
- `docker network ls | grep coolify` → nama network proxy Coolify (biasanya `coolify`).
- `docker ps` → nama container Kikost (jangan disentuh) + tidak ada `cafe-pos-*`.
- `docker inspect coolify-proxy --format '{{json .Config.Cmd}}'` → nama entrypoint
  (`http`/`https`) & certresolver Traefik Coolify.
- `docker volume ls | grep cafe-pos` → kosong.

Bila disk < 5 GB free atau ada nama bentrok → **hentikan deploy**, laporkan.

## 2. Siapkan direktori aplikasi (terpisah dari Coolify & Kikost)

```bash
ssh user@76.13.180.150
sudo mkdir -p /opt/apps/cafe-pos && sudo chown "$USER" /opt/apps/cafe-pos
cd /opt/apps/cafe-pos
git clone <repo-url> .          # atau rsync isi repo
cp deploy/.env.example deploy/.env
```

Isi `deploy/.env` (rahasia BARU, bukan milik Kikost):

```bash
openssl rand -hex 24   # -> POSTGRES_PASSWORD
openssl rand -hex 32   # -> SYNC_DEVICE_KEYS (satu per tablet, pisah koma)
```

Set: `POS_DOMAIN=pos.kikost.com`, `PROXY_NETWORK=coolify`,
`TRAEFIK_HTTPS_ENTRYPOINT=https`, `TRAEFIK_CERTRESOLVER=letsencrypt`
(sesuaikan bila langkah 1 menunjukkan nama lain).

## 3. Pasang di balik Traefik Coolify

`deploy/docker-compose.yml` menempelkan `cafe-pos-web` & `cafe-pos-api` ke network
`coolify` dengan label Traefik. Traefik Coolify menemukannya otomatis dan menerbitkan
sertifikat Let's Encrypt untuk `pos.kikost.com`. **Coolify UI tidak perlu tahu** dan
resource Kikost tidak tersentuh.

> Alternatif (opsional): deploy sebagai resource **Docker Compose** di dalam Coolify UI
> (New Resource → Docker Compose → tempel `deploy/docker-compose.yml`, set domain
> `pos.kikost.com`). Coolify yang mengelola label & TLS. Pilih ini bila ingin POS
> muncul di dashboard Coolify.

Jika ternyata VPS **tidak** memakai Coolify/Traefik (mis. sudah diganti): set
`PROXY_NETWORK=proxy`, `TRAEFIK_HTTPS_ENTRYPOINT=websecure`; atau untuk NPM buat Proxy
Host `pos.kikost.com` → `cafe-pos-web:80` + location `/api` → `cafe-pos-api:8080`.
Jika tidak ada proxy sama sekali: `docker-compose.traefik.yml` (last resort).

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
