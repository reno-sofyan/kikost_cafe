#!/usr/bin/env bash
# Menjalankan seluruh test backend terhadap PostgreSQL sekali pakai (ephemeral).
# Tidak menyentuh database lain di mesin. Kontainer dihapus otomatis di akhir.
set -euo pipefail

CONTAINER="cafe-pos-test-db-$$"
PORT="${TEST_DB_PORT:-55432}"
PGIMAGE="${TEST_DB_IMAGE:-postgres:16-alpine}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ">> Menjalankan PostgreSQL uji: $PGIMAGE (port $PORT)"
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_USER=cafe_pos_test \
  -e POSTGRES_PASSWORD=cafe_pos_test \
  -e POSTGRES_DB=cafe_pos_test \
  -p "$PORT:5432" \
  "$PGIMAGE" >/dev/null

echo -n ">> Menunggu database siap"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U cafe_pos_test -d cafe_pos_test >/dev/null 2>&1; then
    echo " — siap"
    break
  fi
  echo -n "."
  sleep 1
done

export DATABASE_URL="postgres://cafe_pos_test:cafe_pos_test@localhost:$PORT/cafe_pos_test"
export NODE_ENV=test

echo ">> Menjalankan migrasi"
npm run migrate

echo ">> Menjalankan vitest"
npx vitest run "$@"
