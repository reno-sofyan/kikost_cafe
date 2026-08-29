#!/bin/sh
# Restore terkontrol dari arsip pg_dump.
#
# PENTING: JANGAN PERNAH menjalankan restore langsung ke database produksi.
# Skrip ini menolak restore ke PGDATABASE produksi kecuali ALLOW_PROD_RESTORE=yes
# dan target database berbeda dari database produksi.
#
# Pemakaian umum (uji restore ke DB sementara):
#   docker compose -p cafe-pos exec -e RESTORE_TARGET_DB=cafe_pos_restore_test \
#     cafe-pos-backup sh /usr/local/bin/restore.sh /backups/cafe-pos-latest.sql.gz
set -eu

ARCHIVE="${1:-/backups/cafe-pos-latest.sql.gz}"
TARGET_DB="${RESTORE_TARGET_DB:-cafe_pos_restore_test}"
PROD_DB="${PGDATABASE}"

if [ ! -f "${ARCHIVE}" ]; then
  echo "[restore] arsip tidak ditemukan: ${ARCHIVE}"; exit 1
fi
if ! gzip -t "${ARCHIVE}"; then
  echo "[restore] arsip gzip rusak: ${ARCHIVE}"; exit 1
fi

if [ "${TARGET_DB}" = "${PROD_DB}" ] && [ "${ALLOW_PROD_RESTORE:-no}" != "yes" ]; then
  echo "[restore] DITOLAK: target (${TARGET_DB}) sama dengan database produksi."
  echo "[restore] Set RESTORE_TARGET_DB ke database uji, atau ALLOW_PROD_RESTORE=yes bila benar-benar disengaja."
  exit 2
fi

echo "[restore] arsip   : ${ARCHIVE}"
echo "[restore] target DB: ${TARGET_DB}"

# Buat ulang database target (aman: bukan produksi).
psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"${TARGET_DB}\";"

gzip -dc "${ARCHIVE}" | psql -v ON_ERROR_STOP=1 -d "${TARGET_DB}"

# Validasi pasca-restore.
TABLES="$(psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" -d "${TARGET_DB}")"
echo "[restore] tabel publik di ${TARGET_DB}: ${TABLES}"
if [ "${TABLES}" -lt 4 ]; then
  echo "[restore] GAGAL: jumlah tabel tak wajar (${TABLES})"; exit 1
fi

ROWS="$(psql -tAc "SELECT count(*) FROM sync_entity_state" -d "${TARGET_DB}" 2>/dev/null || echo 0)"
echo "[restore] baris sync_entity_state: ${ROWS}"
echo "[restore] OK — restore uji berhasil ke ${TARGET_DB}"
