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
| GET | `/ops/api/tenant/:tenantId/cancellations?days=30` | Bearer | Rekap pembatalan pesanan (1–90 hari): jumlah & nilai, yang batal setelah lunas, rekap per peminta / penyetuju / alasan, dan daftar per pesanan |

### Pelacakan pembatalan

Ringkasan (`/summary`) menyertakan `cancellations` per tenant (jumlah & nilai hari ini dan 7 hari);
dashboard menampilkannya sebagai "Batal hari ini" di kartu tenant dan tab **Pembatalan** di detail.

- Yang dihitung: SEMUA pesanan berstatus `void`, termasuk Rp0. Pesanan yang **dikosongkan dulu** (item
  dihapus) lalu dibatalkan sebagai pesanan kosong ditandai khusus; nilainya = total item yang dihapus, dan
  daftar item yang dihapus/dikurangi (beserta alasan & pelaku sejak app v1.0.14) ikut ditampilkan dari
  entitas `orderItems` (`removed`, `voided`, `removedReason`, `removedByName`, `removedApproval`, `reducedValue`).
- **Tahap** saat batal: `paid` (sudah lunas, uang dikembalikan), `kitchen` (sudah dikonfirmasi/ke dapur), `unprocessed` (masih draft).
- **Peminta / penyetuju / cara persetujuan** dibaca dari field order `voidRequestedByName`, `voidedByName`,
  `voidApproval` (`self` | `supervisor` | `owner_code`) yang diisi app sejak v1.0.13. Untuk data lama,
  diturunkan dari log audit pesanan itu (`order.cancel` → pelaku = peminta; `order.void` → pelaku = penyetuju,
  peminta tidak diketahui). Logika ada di `backend/src/lib/opsCancellations.ts`.
- Hanya data yang sudah tersinkron yang terlihat — tablet tanpa sinkronisasi tidak muncul.

## Keamanan

- Tanpa `OPS_TOKEN` → plugin tidak didaftarkan, seluruh `/ops*` → 404.
- `/ops/api/*` menolak tanpa/ salah token (401).
- Token sebaiknya **berbeda** dari kunci perangkat sync. Rotasi = ganti `OPS_TOKEN` lalu deploy.
- Pertimbangkan membatasi `/ops` di reverse proxy (allowlist IP / basic-auth lapis dua)
  untuk pertahanan berlapis.
