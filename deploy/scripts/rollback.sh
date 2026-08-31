#!/usr/bin/env bash
# Rollback container POS ke image sebelumnya. TIDAK menyentuh container lain.
#
#   ./rollback.sh <api_image_ref> <web_image_ref>
#   ./rollback.sh                 # interaktif: pilih dari .rollback/*.json
#
# Rollback DATA (restore DB) TIDAK dilakukan otomatis — lihat docs/ROLLBACK.md,
# gunakan deploy/backup/restore.sh ke database uji lebih dulu.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT="cafe-pos"
COMPOSE=(docker compose -p "$PROJECT" --env-file .env -f docker-compose.yml)

API_REF="${1:-}"
WEB_REF="${2:-}"

if [ -z "$API_REF" ] || [ -z "$WEB_REF" ]; then
  echo "Snapshot image tersedia:"
  ls -1 .rollback/*.json 2>/dev/null || { echo "Tidak ada snapshot. Berikan ref image manual."; exit 1; }
  echo
  echo "Contoh isi terbaru:"
  latest="$(ls -1t .rollback/*.json | head -1)"
  cat "$latest"
  echo
  echo "Jalankan ulang: ./rollback.sh <API_IMAGE:TAG> <WEB_IMAGE:TAG>"
  exit 0
fi

echo ">> Backup DB sebelum rollback"
"${COMPOSE[@]}" exec -T cafe-pos-backup sh /usr/local/bin/backup.sh || echo "WARN: backup gagal"

echo ">> Menjalankan ulang API & web dengan image lama"
API_IMAGE="$API_REF" WEB_IMAGE="$WEB_REF" "${COMPOSE[@]}" up -d --no-deps --force-recreate cafe-pos-api cafe-pos-web

echo ">> Health check"
for i in $(seq 1 30); do
  "${COMPOSE[@]}" exec -T cafe-pos-api node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 2
  [ "$i" = 30 ] && { echo "FATAL: API tetap tidak sehat"; exit 1; }
done
"${COMPOSE[@]}" ps
echo ">> Rollback selesai."
