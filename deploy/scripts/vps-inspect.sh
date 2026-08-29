#!/usr/bin/env bash
# Pemeriksaan READ-ONLY kondisi VPS sebelum deployment Kikost Cafe POS.
# Skrip ini TIDAK mengubah apa pun: tanpa restart, tanpa pull, tanpa write.
# Jalankan di VPS: bash vps-inspect.sh | tee vps-report-$(date +%F).txt
set -u

line() { printf '\n=== %s ===\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "Kikost Cafe POS — laporan pemeriksaan VPS (read-only)"
echo "Waktu: $(date -u) (UTC)  /  $(date)"
echo "Host : $(hostname)"

line "Sistem Operasi"
[ -f /etc/os-release ] && cat /etc/os-release || uname -a
echo "Kernel: $(uname -r)"
echo "Uptime: $(uptime -p 2>/dev/null || uptime)"

line "CPU"
if have lscpu; then lscpu | grep -E 'Model name|^CPU\(s\)|Thread|Core|Socket'; fi
echo "Load average:$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || true)"

line "Memori & Swap"
free -h 2>/dev/null || vm_stat

line "Disk"
df -hT -x tmpfs -x devtmpfs 2>/dev/null || df -h
echo "-- inode --"
df -i -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR==1 || $5+0 > 0'
echo "-- direktori besar di /var/lib/docker (perkiraan) --"
[ -d /var/lib/docker ] && du -sh /var/lib/docker 2>/dev/null || echo "(tidak ada akses / bukan lokasi docker)"

line "Docker — versi & info"
if have docker; then
  docker version --format 'Client {{.Client.Version}} / Server {{.Server.Version}}' 2>/dev/null
  docker info --format 'Driver: {{.Driver}} | Containers: {{.Containers}} (run {{.ContainersRunning}}) | Images: {{.Images}} | Root: {{.DockerRootDir}}' 2>/dev/null
  echo "Compose: $(docker compose version --short 2>/dev/null || echo 'tidak ada plugin compose')"
else
  echo "docker TIDAK terpasang / tidak di PATH user ini"
fi

line "Container yang berjalan"
have docker && docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null

line "Semua container (termasuk berhenti)"
have docker && docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null

line "Pemakaian resource per container (snapshot)"
have docker && timeout 10 docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null

line "Docker networks"
have docker && docker network ls 2>/dev/null
echo "-- kandidat network reverse proxy --"
have docker && for n in $(docker network ls --format '{{.Name}}' 2>/dev/null); do
  case "$n" in
    *proxy*|*traefik*|*npm*|*nginx*|web) echo "  $n"; docker network inspect "$n" --format '    containers: {{range $k,$v := .Containers}}{{$v.Name}} {{end}}' 2>/dev/null;;
  esac
done

line "Docker volumes"
have docker && docker volume ls 2>/dev/null

line "Port yang sedang LISTEN"
if have ss; then ss -tulpn 2>/dev/null | grep LISTEN
elif have netstat; then netstat -tulpn 2>/dev/null | grep LISTEN
fi
echo "-- apakah 80/443 dipakai? --"
(have ss && ss -tulpn 2>/dev/null | grep -E ':80 |:443 ') || true

line "Reverse proxy terdeteksi"
have docker && docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -Ei 'traefik|nginx-proxy|nginxproxy|npm|proxy-manager|caddy' || echo "(tidak terdeteksi container reverse proxy dari nama/image)"
for p in /opt /srv /root /home; do
  [ -d "$p" ] && find "$p" -maxdepth 3 -iname 'docker-compose*.y*ml' 2>/dev/null | head -20
done

line "Layanan systemd terkait (nginx/postgres/docker)"
have systemctl && systemctl list-units --type=service --state=running 2>/dev/null | grep -Ei 'nginx|postgres|docker|traefik' || true

line "PostgreSQL di host (bukan container)?"
have pg_lsclusters && pg_lsclusters 2>/dev/null || echo "(tidak ada pg_lsclusters — kemungkinan tidak ada PG host)"
(have ss && ss -tulpn 2>/dev/null | grep ':5432 ') || echo "(tidak ada listener :5432 di host — baik, PG hanya di dalam container)"

line "Firewall"
have ufw && ufw status verbose 2>/dev/null
have firewall-cmd && firewall-cmd --list-all 2>/dev/null
have nft && nft list ruleset 2>/dev/null | head -40

line "Cron / jadwal backup yang sudah ada"
ls -la /etc/cron.d 2>/dev/null
crontab -l 2>/dev/null | grep -vE '^\s*#' || echo "(crontab user kosong)"
for p in /opt /srv /root; do [ -d "$p" ] && find "$p" -maxdepth 4 -iname '*backup*' 2>/dev/null | head -20; done

line "Estimasi pemakaian kikost.com (read-only)"
have docker && docker ps --format '{{.Names}}' 2>/dev/null | grep -i kikost | while read -r c; do
  echo "-- $c --"
  timeout 8 docker stats --no-stream --format '   CPU {{.CPUPerc}} | MEM {{.MemUsage}} ({{.MemPerc}})' "$c" 2>/dev/null
  docker inspect "$c" --format '   restart={{.HostConfig.RestartPolicy.Name}} mem_limit={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}}' 2>/dev/null
done

line "Ringkasan keputusan"
cat <<'EOF'
Periksa poin berikut sebelum lanjut deploy POS:
  [ ] Ada network reverse proxy (mis. 'proxy') yang bisa dipakai bersama? -> set PROXY_NETWORK
  [ ] Traefik punya certresolver Let's Encrypt aktif?                     -> set TRAEFIK_CERTRESOLVER
  [ ] Port 80/443 HANYA dipegang reverse proxy?
  [ ] Disk bebas > 5 GB dan inode cukup?
  [ ] RAM bebas cukup untuk +~1 GB (PG 512M + API 384M + web 128M)?
  [ ] Tidak ada container/volume/network bernama cafe-pos-* yang bentrok?
  [ ] DNS pos.kikost.com sudah mengarah ke IP VPS?
Jika salah satu meragukan: hentikan bagian DEPLOY saja, laporkan, lanjutkan dev/test/build.
EOF
echo
echo "Selesai. Simpan output ini ke docs/ sebagai bukti pemeriksaan."
