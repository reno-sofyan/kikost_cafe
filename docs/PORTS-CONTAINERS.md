# Daftar Container, Port, Volume, Network

Docker Compose project: **`cafe-pos`** (terpisah total dari Kikost).

## Container

| Container | Image | Peran | Restart | Limit (default) | Healthcheck |
|---|---|---|---|---|---|
| `cafe-pos-postgres` | `postgres:16-alpine` | Database POS | unless-stopped | 1.0 CPU / 512M | `pg_isready` tiap 15s |
| `cafe-pos-api` | `cafe-pos-api` (build `backend/`) | API sinkronisasi Fastify | unless-stopped | 1.0 CPU / 384M | `GET /api/health` tiap 30s |
| `cafe-pos-web` | `cafe-pos-web` (build root `Dockerfile`) | PWA statis (nginx) | unless-stopped | 0.5 CPU / 128M | `GET /healthz` tiap 30s |
| `cafe-pos-backup` | `postgres:16-alpine` | Cron `pg_dump` harian | unless-stopped | 0.5 CPU / 128M | ada backup < 26 jam |
| `cafe-pos-traefik` *(opsional)* | `traefik:v3.1` | Reverse proxy — HANYA bila VPS belum punya | unless-stopped | 0.5 CPU / 128M | — |

## Port

| Port | Diekspos ke | Oleh | Catatan |
|---|---|---|---|
| 80, 443 | Internet | Reverse proxy (Traefik/NPM yang sudah ada) | **Hanya** reverse proxy. Stack POS tidak mem-bind port host. |
| 8080 (API) | Internal `cafe-pos-internal` + `proxy` | `cafe-pos-api` | Tidak di-publish ke host di produksi. |
| 80 (web) | Internal `proxy` | `cafe-pos-web` | Tidak di-publish ke host di produksi. |
| 5432 | **Internal saja** (`cafe-pos-internal`) | `cafe-pos-postgres` | **Tidak pernah** ke host/internet. |

Uji lokal (`docker-compose.local.yml`) mem-publish `127.0.0.1:8080` (web) & `127.0.0.1:8081` (api) — bukan untuk produksi.

## Network

| Network | Tipe | Anggota | Tujuan |
|---|---|---|---|
| `cafe-pos-internal` | `internal: true` (tanpa akses internet) | postgres, api, backup | Lalu lintas DB terisolasi |
| `proxy` (`PROXY_NETWORK`) | external (milik reverse proxy yang ada) | api, web | Routing dari reverse proxy |

## Volume

| Volume | Mount | Isi |
|---|---|---|
| `cafe-pos-pgdata` | `cafe-pos-postgres:/var/lib/postgresql/data` | Data PostgreSQL |
| `cafe-pos-backups` | `cafe-pos-backup:/backups` | Arsip `*.sql.gz` + `cafe-pos-latest.sql.gz` |
| `cafe-pos-traefik-acme` *(opsional)* | `cafe-pos-traefik:/acme` | Sertifikat Let's Encrypt |

## Routing (Traefik labels)

| Router | Rule | Service |
|---|---|---|
| `cafe-pos-api` | `Host(pos.kikost.com) && PathPrefix(/api)` prio 20 | `cafe-pos-api:8080` |
| `cafe-pos-web` | `Host(pos.kikost.com)` prio 10 | `cafe-pos-web:80` |

Middleware `cafe-pos-secheaders`: HSTS, nosniff, XSS filter, referrer-policy.

## Logging

Semua container: driver `json-file`, `max-size=10m`, `max-file=5` (rotasi otomatis,
maks ± 50 MB/ container).
