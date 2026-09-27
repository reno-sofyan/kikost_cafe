#!/bin/sh
# Entrypoint container cafe-pos-backup: menjadwalkan pg_dump harian via cron.
set -eu

BACKUP_CRON="${BACKUP_CRON:-15 18 * * *}"

echo "[backup] container start; jadwal cron: ${BACKUP_CRON}"

if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  echo "[backup] BACKUP_ON_START=true -> menjalankan backup awal"
  /usr/local/bin/backup.sh || echo "[backup] backup awal GAGAL (lanjut)"
fi

# Tulis crontab. Variabel lingkungan diteruskan lewat file env agar tersedia di sesi cron.
#
# PENTING — jangan lagi tulis `env | sed 's/^/export /'` tanpa quoting: nilai APA PUN yang
# mengandung spasi (BACKUP_CRON="15 18 * * *" SELALU begitu — itu memang bentuk ekspresi
# cron) pecah jadi beberapa kata saat `export` membacanya tanpa kutip, dan kata kedua
# ("18") ditolak sebagai nama variabel tidak valid ("bad variable name"). Ini membuat
# SETIAP backup terjadwal gagal total sejak awal, diam-diam — healthcheck tetap "healthy"
# karena cuma mengecek crond hidup, bukan bahwa backup benar-benar pernah tersimpan.
# Perbaikan: ambil tiap nilai dari variabel shell-nya sendiri (bukan re-parse teks `env`),
# lalu quote tunggal POSIX-aman — tahan spasi, tanda kutip, maupun newline literal.
: > /etc/backup.env
chmod 600 /etc/backup.env
for var_name in $(env | LC_ALL=C sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | grep -E '^(PG|BACKUP_)'); do
  eval "var_value=\$$var_name"
  escaped=$(printf '%s' "$var_value" | sed "s/'/'\\\\''/g")
  printf "export %s='%s'\n" "$var_name" "$escaped" >> /etc/backup.env
done
echo "${BACKUP_CRON} . /etc/backup.env; /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root

# crond foreground, level log 8
exec crond -f -l 8
