#!/usr/bin/env bash
# Picu redeploy pos.kikost.com lewat Coolify API — alternatif manual untuk
# `.github/workflows/deploy.yml` selama repo secret COOLIFY_TOKEN belum diisi.
#
# Pakai SETELAH `git push` (biar CI sempat memvalidasi):
#   bash deploy/trigger.sh
#
# Token dibaca dari deploy/.env.coolify (gitignored). Auth diteruskan lewat
# berkas -K sementara supaya tak muncul di `ps` / history.
set -euo pipefail
cd "$(dirname "$0")/.."

ENVFILE="deploy/.env.coolify"
[ -f "$ENVFILE" ] || { echo "ERR: $ENVFILE tidak ada — token Coolify diperlukan." >&2; exit 1; }

# `|| true`: grep exits 1 when the key is absent; without it `set -e` + pipefail
# would abort the script before the `:-` default below can kick in.
TOKEN=$( { grep -E '^COOLIFY_TOKEN=' "$ENVFILE" || true; } | head -1 | cut -d= -f2- | tr -d ' "'"'"'')
UUID=$( { grep -E '^COOLIFY_APP_UUID=' "$ENVFILE" || true; } | head -1 | cut -d= -f2- | tr -d ' "'"'"'')
UUID=${UUID:-qilynan1p0jvsiqjkkins6ot}
BASE=${COOLIFY_BASE:-https://coolify.kikost.com}
[ -n "$TOKEN" ] || { echo "ERR: COOLIFY_TOKEN kosong di $ENVFILE" >&2; exit 1; }

RC=$(mktemp); trap 'rm -f "$RC"' EXIT
printf 'header = "Authorization: Bearer %s"\nrequest = "POST"\nsilent\nshow-error\n' "$TOKEN" > "$RC"
chmod 600 "$RC"

# Sidik jari build yang sedang tayang SEBELUM deploy — hash bundel entri di
# index.html berubah tiap build, jadi ini penanda "build baru live" yang andal
# (cek /api/devices lama selalu lolos karena rute itu sudah ada sejak Fase 2c).
bundle_now() { curl -s -m 10 "https://pos.kikost.com/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1; }
BEFORE=$(bundle_now || true)
echo ">> Bundel saat ini: ${BEFORE:-tak terbaca}"

echo ">> Memicu redeploy Coolify (app $UUID)…"
code=$(curl -s -X POST "$BASE/api/v1/deploy?uuid=$UUID" -K "$RC" -o /tmp/coolify-deploy-resp.json -w '%{http_code}')
echo "HTTP $code"; cat /tmp/coolify-deploy-resp.json; echo
case "$code" in 2*) ;; *) echo "::gagal:: HTTP $code" >&2; exit 1 ;; esac

echo ">> Menunggu build baru live (maks ~15 mnt)…"
for i in $(seq 1 90); do
  h=$(curl -s -m 10 "https://pos.kikost.com/api/health" || true)
  b=$(bundle_now || true)
  echo "  [$i] health=$(echo "${h:-none}" | grep -oE '\"db\":\"[a-z]+\"' || echo none) bundle=${b:-none}"
  if echo "$h" | grep -q '"db":"ok"' && [ -n "$b" ] && [ "$b" != "$BEFORE" ]; then
    echo ">> Build baru live & sehat (bundel ${BEFORE:-?} → $b)."; exit 0
  fi
  sleep 10
done
echo "::timeout:: bundel belum berubah dari ${BEFORE:-?} — cek dashboard Coolify." >&2; exit 1
