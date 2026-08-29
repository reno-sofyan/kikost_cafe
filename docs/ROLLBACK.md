# Rollback

Dua tingkat: **kode/container** (cepat, aman) dan **data/DB** (hati-hati, lewat DB uji dulu).

## A. Rollback container (image sebelumnya)

`deploy.sh` menulis snapshot versi image ke `deploy/.rollback/images-*.json` sebelum
tiap deploy.

```bash
cd /opt/apps/cafe-pos/deploy
./scripts/rollback.sh                      # tampilkan snapshot & instruksi
./scripts/rollback.sh <API_IMAGE:TAG> <WEB_IMAGE:TAG>
```

Skrip: backup DB → `docker compose up -d --no-deps --force-recreate cafe-pos-api cafe-pos-web`
dengan tag lama → tunggu `/api/health`. Hanya container POS. Kikost tidak disentuh.

Bila memakai build lokal (bukan registry): image lama masih ada selama belum
`docker image prune`. Lihat `docker images | grep cafe-pos`.

## B. Rollback migrasi database

Migrasi bersifat **additif**; rollback hanya bila migrasi terakhir benar-benar
bermasalah dan Anda paham dampaknya.

```bash
# di dalam direktori backend, dengan DATABASE_URL mengarah ke DB POS
docker compose -p cafe-pos exec cafe-pos-api node dist/db/migrate.js status
docker compose -p cafe-pos exec cafe-pos-api node dist/db/migrate.js down 1
```

Setiap migrasi punya bagian `-- +migrate Down`. `down` menolak bila bagian Down kosong.
**Selalu** `backup.sh` sebelum menjalankan `down` (deploy.sh sudah melakukannya untuk `up`).

## C. Restore data dari backup

> **JANGAN PERNAH** restore langsung ke database produksi. `restore.sh` menolak target
> = DB produksi kecuali `ALLOW_PROD_RESTORE=yes` (hanya untuk pemulihan bencana sadar penuh).

### Uji restore (rutin, wajib berkala)

```bash
docker compose -p cafe-pos exec \
  -e RESTORE_TARGET_DB=cafe_pos_restore_test \
  cafe-pos-backup sh /usr/local/bin/restore.sh /backups/cafe-pos-latest.sql.gz
```

Skrip membuat DB `cafe_pos_restore_test` baru, meng-import dump, lalu memvalidasi
jumlah tabel & baris. Hapus DB uji setelah selesai:

```bash
docker compose -p cafe-pos exec cafe-pos-postgres \
  psql -U "$POSTGRES_USER" -d postgres -c 'DROP DATABASE cafe_pos_restore_test;'
```

### Pemulihan bencana (DB produksi rusak/hilang)

1. Hentikan API agar tak ada tulisan: `docker compose -p cafe-pos stop cafe-pos-api`.
2. Backup kondisi rusak saat ini (untuk forensik): `backup.sh`.
3. Restore ke DB produksi (sadar penuh):
   ```bash
   docker compose -p cafe-pos exec \
     -e RESTORE_TARGET_DB="$POSTGRES_DB" -e ALLOW_PROD_RESTORE=yes \
     cafe-pos-backup sh /usr/local/bin/restore.sh /backups/<arsip-yang-dipilih>.sql.gz
   ```
4. `docker compose -p cafe-pos start cafe-pos-api`, cek `/api/health`.
5. Perangkat kasir: data lokal (IndexedDB) tetap utuh; sinkronisasi akan mengisi ulang
   server dari perangkat. Transaksi yang sudah `paid` di perangkat tidak akan tertimpa.

## D. Rollback penuh stack POS (tanpa menyentuh Kikost)

```bash
cd /opt/apps/cafe-pos/deploy
docker compose -p cafe-pos down           # TANPA -v : volume (data) dipertahankan
# untuk menghapus data POS juga (mis. mulai bersih): tambahkan -v  (TIDAK memengaruhi Kikost)
```

## Kriteria sukses rollback

- `/api/health` = ok, DB ok
- `https://pos.kikost.com` 200, PWA jalan
- `kikost.com` tetap normal
- data transaksi/stok/shift/laporan konsisten dengan perangkat kasir
