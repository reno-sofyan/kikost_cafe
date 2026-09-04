#!/bin/sh
# pg_dump terkompresi + rotasi retensi + verifikasi ringan.
# Dijalankan di dalam container cafe-pos-backup (image postgres:16-alpine).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/cafe-pos-${PGDATABASE}-${TS}.sql.gz"
TMP="${OUT}.partial"

mkdir -p "${BACKUP_DIR}"

echo "[backup] mulai ${TS} -> ${OUT}"

# --clean --if-exists agar dump bisa dipulihkan ke database yang sudah ada.
pg_dump --no-owner --no-privileges --clean --if-exists --format=plain \
  | gzip -9 > "${TMP}"

# Verifikasi: file gzip valid dan memuat pernyataan SQL.
if ! gzip -t "${TMP}"; then
  echo "[backup] GAGAL: arsip gzip rusak"; rm -f "${TMP}"; exit 1
fi
if [ "$(gzip -dc "${TMP}" | head -c 200 | wc -c)" -lt 20 ]; then
  echo "[backup] GAGAL: dump tampak kosong"; rm -f "${TMP}"; exit 1
fi

mv "${TMP}" "${OUT}"
SIZE="$(du -h "${OUT}" | cut -f1)"
echo "[backup] sukses (${SIZE})"

# Rotasi: hapus dump lebih tua dari RETENTION_DAYS.
find "${BACKUP_DIR}" -name "cafe-pos-${PGDATABASE}-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete || true

# Salinan "latest" untuk kemudahan + penanda sukses untuk healthcheck.
cp -f "${OUT}" "${BACKUP_DIR}/cafe-pos-latest.sql.gz"
date -u +%s > "${BACKUP_DIR}/.last_success"

# --- Off-site: S3-kompatibel via rclone (Backblaze B2 / R2 / Wasabi / AWS / MinIO) ---
# Set BACKUP_S3_BUCKET + BACKUP_S3_ACCESS_KEY + BACKUP_S3_SECRET_KEY
# (+ BACKUP_S3_ENDPOINT untuk non-AWS, + BACKUP_S3_PREFIX opsional).
# Tidak fatal bila gagal — backup lokal tetap sukses.
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ] && [ -n "${BACKUP_S3_SECRET_KEY:-}" ]; then
  echo "[backup] unggah off-site ke s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-cafe-pos}"
  RCLONE_CFG="$(mktemp)"
  {
    echo "[offsite]"
    echo "type = s3"
    echo "provider = ${BACKUP_S3_PROVIDER:-Other}"
    echo "access_key_id = ${BACKUP_S3_ACCESS_KEY}"
    echo "secret_access_key = ${BACKUP_S3_SECRET_KEY}"
    [ -n "${BACKUP_S3_ENDPOINT:-}" ] && echo "endpoint = ${BACKUP_S3_ENDPOINT}"
    [ -n "${BACKUP_S3_REGION:-}" ] && echo "region = ${BACKUP_S3_REGION}"
  } > "${RCLONE_CFG}"
  DEST="offsite:${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-cafe-pos}"
  if rclone --config "${RCLONE_CFG}" copy "${OUT}" "${DEST}/" \
       && rclone --config "${RCLONE_CFG}" copyto "${OUT}" "${DEST}/cafe-pos-latest.sql.gz"; then
    # Retensi off-site sejajar dengan lokal.
    rclone --config "${RCLONE_CFG}" delete --min-age "${RETENTION_DAYS}d" \
      --include "cafe-pos-${PGDATABASE}-*.sql.gz" "${DEST}/" || true
    echo "[backup] off-site sukses"
  else
    echo "[backup] off-site GAGAL (lanjut) — periksa kredensial / endpoint"
  fi
  rm -f "${RCLONE_CFG}"
fi

# Hook off-site kustom opsional (mis. skrip rclone/scp sendiri). Tidak fatal bila gagal.
if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  echo "[backup] menjalankan hook off-site kustom"
  sh -c "${BACKUP_OFFSITE_CMD}" "${OUT}" || echo "[backup] hook off-site kustom GAGAL (lanjut)"
fi

echo "[backup] selesai"
