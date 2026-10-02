# Konsol Operator (`/ops`)

Dashboard lintas-tenant untuk **pemilik backend** memantau semua usaha (cafe, kantin,
minimarket) yang menyinkron ke satu server ini: omzet & transaksi, kesehatan teknis
(perangkat online, push ditolak), log aktivitas, dan ringkasan per tenant.

Ini perkakas operasional terpisah — **tidak ditautkan dari mana pun di app POS** (tidak
ada menu, tidak ada tombol). Hanya bisa dibuka lewat URL langsung + token.

## Yang dibaca & tidak dibaca

- **Hanya membaca** data yang memang **sudah disinkronkan** tiap tenant ke server
  (`sync_entity_state`, `sync_devices`, `sync_push_log`). Konsol ini **tidak** menambah
  pengumpulan data baru dari perangkat, tidak mengubah apa pun (read-only).
- Business type & nama usaha diambil dari entity `settings` tiap tenant.

## Kepatuhan / privasi

Akses operator ke data tenant untuk dukungan & pemantauan **sebaiknya diungkap** di
syarat layanan / kebijakan privasi kepada pemilik usaha (UU PDP). Menyembunyikannya dari
pelanggan sendiri menimbulkan risiko kepatuhan — simpan konsol ini terpisah & tak
diiklankan, tapi jangan jadikan mekanisme untuk menipu pengguna soal adanya pemantauan.

## Aktivasi

1. Buat token acak panjang:
   ```bash
   openssl rand -hex 32
   ```
2. Set env `OPS_TOKEN` di backend (lihat `deploy/.env.example`). **Kosong = `/ops`
   mati total (404).**
3. Deploy ulang. Buka `https://pos.kikost.com/ops` (Traefik merutekan `/api` dan `/ops` ke backend — lihat label `cafe-pos-api` di `deploy/docker-compose.yml`), tempel token.

Token dikirim sebagai `Authorization: Bearer <token>` dari halaman ke `/ops/api/*`
(disimpan di `sessionStorage`, tidak pernah di URL). Perbandingan token timing-safe.

## Endpoint

| Method | Path | Auth | Isi |
|---|---|---|---|
| GET | `/ops` | — | Shell HTML (tanpa data) |
| GET | `/ops/api/summary` | Bearer | Ringkasan semua tenant (omzet hari ini, 7 hari, perangkat, kesehatan) |
| GET | `/ops/api/tenant/:tenantId` | Bearer | Detail satu tenant (total omzet, transaksi terbaru, log aktivitas) |

## Keamanan

- Tanpa `OPS_TOKEN` → plugin tidak didaftarkan, seluruh `/ops*` → 404.
- `/ops/api/*` menolak tanpa/ salah token (401).
- Token sebaiknya **berbeda** dari kunci perangkat sync. Rotasi = ganti `OPS_TOKEN` lalu deploy.
- Pertimbangkan membatasi `/ops` di reverse proxy (allowlist IP / basic-auth lapis dua)
  untuk pertahanan berlapis.
