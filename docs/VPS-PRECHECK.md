# Pemeriksaan VPS Sebelum Deploy (READ-ONLY)

Skrip: [`deploy/scripts/vps-inspect.sh`](../deploy/scripts/vps-inspect.sh).
**Tidak mengubah apa pun** — tanpa `restart`, `pull`, `up`, atau tulis file.

## Menjalankan

```bash
scp deploy/scripts/vps-inspect.sh user@vps:/tmp/
ssh user@vps 'bash /tmp/vps-inspect.sh' | tee docs/vps-report-$(date +%F).txt
git add docs/vps-report-*.txt   # simpan sebagai bukti (tidak berisi secret)
```

## Yang diperiksa

| Bagian | Untuk memastikan |
|---|---|
| OS, kernel, uptime | kompatibilitas dasar |
| CPU, load average | headroom untuk container POS |
| Memori & swap | ada ± 1 GB bebas (PG 512M + API 384M + web 128M) |
| Disk & inode, ukuran `/var/lib/docker` | ada > 5 GB bebas |
| Docker & Compose versi | Compose v2 tersedia |
| Container berjalan + `docker stats` | tidak ada nama `cafe-pos-*`; beban Kikost |
| Docker networks | ada network reverse proxy yang bisa dibagi |
| Docker volumes | tidak ada `cafe-pos-*` yang bentrok |
| Port LISTEN + cek 80/443 | hanya reverse proxy yang pegang 80/443 |
| Reverse proxy terdeteksi | Traefik / NPM / Caddy dan lokasinya |
| PostgreSQL host | tidak ada `:5432` publik di host |
| Firewall (ufw/firewalld/nft) | aturan yang ada — **jangan diubah** untuk Kikost |
| Cron / skrip backup | pola backup yang sudah ada |
| Pemakaian container `kikost*` | baseline sebelum deploy |

## Membaca hasil

Bagian **"Ringkasan keputusan"** di akhir output berisi checklist. Semua harus lolos
sebelum lanjut ke `DEPLOYMENT.md`:

- [ ] network reverse proxy tersedia → set `PROXY_NETWORK`
- [ ] Traefik punya certresolver Let's Encrypt → set `TRAEFIK_CERTRESOLVER`
      (atau siapkan `docker-compose.traefik.yml` bila belum ada proxy sama sekali)
- [ ] 80/443 hanya di reverse proxy
- [ ] disk bebas > 5 GB, inode cukup
- [ ] RAM bebas cukup untuk ± 1 GB
- [ ] tidak ada `cafe-pos-*` container/volume/network
- [ ] DNS `pos.kikost.com` → IP VPS

**Bila ada yang meragukan**: hentikan HANYA bagian deploy, laporkan temuan + tindakan
aman yang diperlukan. Development, test, image, dan dokumentasi tetap diselesaikan.
