# Backup & Restore

## Apa yang di-backup

| Lapisan | Mekanisme | Lokasi |
|---|---|---|
| Database server (kanonik + idempotency) | `pg_dump` harian container `cafe-pos-backup` | volume `cafe-pos-backups` → `/backups/*.sql.gz` |
| Sebelum tiap deploy / migrasi `up` | `deploy.sh` memanggil `backup.sh` | idem |
| Data lokal perangkat (IndexedDB) | ekspor JSON dari menu Administrator | file di tablet / share sheet |

Data operasional yang sesungguhnya juga **selalu ada di tiap tablet** (offline-first),
jadi kehilangan DB server bukan kehilangan data selama perangkat masih ada.

## Jadwal & retensi

- Cron: `BACKUP_CRON` (default `15 18 * * *` = 01:15 WIB).
- Retensi: `BACKUP_RETENTION_DAYS` (default 14) — arsip lebih tua dihapus otomatis.
- `cafe-pos-latest.sql.gz` selalu = backup terakhir.
- `BACKUP_ON_START=true` (default): satu backup ditulis segera tiap container start.
- Healthcheck: sehat selama `crond` hidup; unhealthy hanya bila sudah pernah ada
  backup sukses tapi yang terakhir > 26 jam.
- Skrip di-*bake* ke image `deploy/backup/Dockerfile` (bukan bind-mount), supaya
  tahan terhadap runner Coolify yang membersihkan direktori checkout pasca-deploy.

## Backup manual

```bash
docker compose -p cafe-pos exec cafe-pos-backup sh /usr/local/bin/backup.sh
docker compose -p cafe-pos exec cafe-pos-backup ls -lh /backups
```

Dari aplikasi: **Pengaturan → Backup** (Administrator) → "Ekspor Backup" menghasilkan
file JSON seluruh data lokal perangkat itu.

## Off-site (disarankan)

`rclone` sudah terpasang di image `cafe-pos-backup`. Isi kredensial S3-kompatibel
di `deploy/.env` (atau env Coolify) — berlaku untuk **Backblaze B2, Cloudflare R2,
Wasabi, AWS S3, MinIO**:

```bash
BACKUP_S3_BUCKET=nama-bucket
BACKUP_S3_ACCESS_KEY=xxxxx
BACKUP_S3_SECRET_KEY=xxxxx
# Non-AWS wajib endpoint, mis:
#   Backblaze B2 : https://s3.us-west-004.backblazeb2.com
#   Cloudflare R2: https://<accountid>.r2.cloudflarestorage.com
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
# Opsional:
# BACKUP_S3_REGION=us-west-004
# BACKUP_S3_PROVIDER=Backblaze   # atau Cloudflare, Wasabi, AWS, Minio, Other
# BACKUP_S3_PREFIX=cafe-pos      # folder dalam bucket
```

Tiap backup harian lalu diunggah: `<bucket>/<prefix>/cafe-pos-<db>-<ts>.sql.gz`
+ `cafe-pos-latest.sql.gz`. Retensi off-site = `BACKUP_RETENTION_DAYS`. Kegagalan
unggah **tidak** menggagalkan backup lokal (dicatat di log container).

Uji: `docker compose -p cafe-pos exec cafe-pos-backup sh /usr/local/bin/backup.sh`
lalu cek log — harus muncul `[backup] off-site sukses`.

Butuh target non-S3 (SFTP/Google Drive/dsb)? Pakai `BACKUP_OFFSITE_CMD` — sebuah
perintah shell dengan `$1` = path arsip baru, mis.
`BACKUP_OFFSITE_CMD=rclone --config /cfg/rclone.conf copy "$1" gdrive:cafe-pos`
(mount config-nya). Alternatif paling sederhana: `rsync` volume `cafe-pos-backups`
dari cron host.

## Uji restore (WAJIB berkala, mis. bulanan)

Selalu ke database **uji**, tidak pernah ke produksi:

```bash
docker compose -p cafe-pos exec \
  -e RESTORE_TARGET_DB=cafe_pos_restore_test \
  cafe-pos-backup sh /usr/local/bin/restore.sh /backups/cafe-pos-latest.sql.gz
# validasi otomatis: jumlah tabel & baris sync_entity_state
docker compose -p cafe-pos exec cafe-pos-postgres \
  psql -U "$POSTGRES_USER" -d postgres -c 'DROP DATABASE cafe_pos_restore_test;'
```

Catat tanggal & hasil uji di `TEST-PLAN.md`.

## Pemulihan bencana

Lihat `ROLLBACK.md` bagian C.
