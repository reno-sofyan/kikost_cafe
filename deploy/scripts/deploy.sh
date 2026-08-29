#!/usr/bin/env bash
# Deploy / update HANYA container POS. Tidak menyentuh container lain di VPS.
#
# Pemakaian di VPS (dari /opt/apps/cafe-pos):
#   ./deploy.sh            # build + up container POS, jalankan migrasi
#   ./deploy.sh --pull     # tarik image dari registry (tanpa build lokal)
#   ./deploy.sh --no-build # up ulang tanpa build (mis. hanya ganti env)
set -euo pipefail

cd "$(dirname "$0")/.."          # -> direktori deploy/
PROJECT="cafe-pos"
COMPOSE=(docker compose -p "$PROJECT" --env-file .env -f docker-compose.yml)

MODE="build"
for arg in "$@"; do
  case "$arg" in
    --pull) MODE="pull" ;;
    --no-build) MODE="none" ;;
    *) echo "arg tidak dikenal: $arg"; exit 1 ;;
  esac
done

[ -f .env ] || { echo "FATAL: .env belum ada. Salin dari .env.example."; exit 1; }

echo ">> Validasi konfigurasi compose"
"${COMPOSE[@]}" config >/dev/null

echo ">> Snapshot versi image saat ini (untuk rollback)"
mkdir -p .rollback
"${COMPOSE[@]}" images --format json > ".rollback/images-$(date -u +%Y%m%dT%H%M%SZ).json" 2>/dev/null || true

echo ">> Backup database SEBELUM perubahan (aman walau tanpa migrasi baru)"
if "${COMPOSE[@]}" ps --status running --services | grep -q cafe-pos-backup; then
  "${COMPOSE[@]}" exec -T cafe-pos-backup sh /usr/local/bin/backup.sh || echo "WARN: pre-deploy backup gagal"
fi

case "$MODE" in
  build) echo ">> Build image POS"; "${COMPOSE[@]}" build ;;
  pull)  echo ">> Pull image POS";  "${COMPOSE[@]}" pull ;;
  none)  echo ">> Lewati build/pull" ;;
esac

echo ">> Menaikkan HANYA service POS (--no-deps, tanpa menyentuh proxy/kikost)"
"${COMPOSE[@]}" up -d --no-deps --remove-orphans \
  cafe-pos-postgres cafe-pos-api cafe-pos-web cafe-pos-backup

echo ">> Menunggu health API"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T cafe-pos-api node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "   API sehat setelah ${i}x cek"; break
  fi
  sleep 2
  [ "$i" = 30 ] && { echo "FATAL: API tidak sehat. Pertimbangkan ./rollback.sh"; exit 1; }
done

echo ">> Status akhir"
"${COMPOSE[@]}" ps
echo ">> Selesai. kikost.com tidak disentuh oleh proses ini."
