# Image container cafe-pos-backup: pg_dump harian terjadwal.
#
# Skrip DIPANGGANG ke image (bukan bind-mount) supaya tahan terhadap Coolify
# yang membersihkan direktori checkout (/artifacts/<uuid>) setelah deploy —
# bind-mount relatif akan berubah jadi direktori kosong saat container restart
# dan membuat entrypoint gagal (crash-loop).
FROM postgres:16-alpine

# rclone: satu binari statis, untuk unggah off-site ke penyimpanan S3-kompatibel
# (Backblaze B2 / Cloudflare R2 / Wasabi / AWS / MinIO). Opsional saat runtime.
RUN apk add --no-cache rclone

COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]
