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
env | grep -E '^(PG|BACKUP_)' | sed 's/^/export /' > /etc/backup.env
echo "${BACKUP_CRON} . /etc/backup.env; /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root

# crond foreground, level log 8
exec crond -f -l 8
