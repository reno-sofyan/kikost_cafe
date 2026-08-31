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
- Healthcheck container gagal bila tidak ada backup sukses dalam 26 jam.

## Backup manual

```bash
docker compose -p cafe-pos exec cafe-pos-backup sh /usr/local/bin/backup.sh
docker compose -p cafe-pos exec cafe-pos-backup ls -lh /backups
```

Dari aplikasi: **Pengaturan → Backup** (Administrator) → "Ekspor Backup" menghasilkan
file JSON seluruh data lokal perangkat itu.

## Off-site (disarankan)

Set di `deploy/.env`:

```bash
BACKUP_OFFSITE_CMD=rclone copy "$1" remote:cafe-pos-backups
```

`$1` = path arsip yang baru dibuat. Pasang `rclone` + konfigurasi di image backup
(atau mount config). Kegagalan hook off-site tidak menggagalkan backup lokal.

Alternatif sederhana: `scp`/`rsync` volume `cafe-pos-backups` ke storage lain lewat cron host.

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
