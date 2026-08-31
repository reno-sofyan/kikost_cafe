#!/usr/bin/env bash
# Menjalankan PostgreSQL ephemeral + backend API untuk test e2e sinkronisasi.
# Dipakai sebagai webServer oleh playwright.sync.config.ts. Ctrl-C / SIGTERM membersihkan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTAINER="cafe-pos-e2e-db"
PGPORT="${E2E_DB_PORT:-55433}"
APIPORT="${E2E_API_PORT:-8091}"
DEVICE_KEY="${E2E_DEVICE_KEY:-e2e-sync-key-abcdef0123456789}"

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "[e2e] start postgres :$PGPORT"
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_USER=cafe_pos_e2e -e POSTGRES_PASSWORD=cafe_pos_e2e -e POSTGRES_DB=cafe_pos_e2e \
  -p "$PGPORT:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U cafe_pos_e2e -d cafe_pos_e2e >/dev/null 2>&1 && break
  sleep 1
done

export DATABASE_URL="postgres://cafe_pos_e2e:cafe_pos_e2e@localhost:$PGPORT/cafe_pos_e2e"
export NODE_ENV=production
export HOST=127.0.0.1
export PORT="$APIPORT"
export SYNC_DEVICE_KEYS="$DEVICE_KEY"
export CORS_ORIGINS="http://localhost:4173"
export LOG_LEVEL=warn

cd "$ROOT/backend"
echo "[e2e] migrate + start api :$APIPORT"
npx tsx src/db/migrate.ts up
npx tsx src/index.ts &
API_PID=$!

wait "$API_PID"
