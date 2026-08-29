# Arsitektur

## Prinsip

- **Offline-first**: seluruh operasi kasir berjalan penuh tanpa internet. Sumber
  kebenaran operasional ada di perangkat (IndexedDB via Dexie).
- **Server sebagai relay + backup**: backend menyimpan state kanonik per entitas,
  menegakkan idempotency dan proteksi transaksi final, serta menjadi sumber `pg_dump`.
- **Satu outlet, beberapa perangkat**: kasir, dapur (KDS), dan tablet manajer bisa
  berbagi data lewat sinkronisasi.

## Komponen

```
┌─────────── Tablet Android / Touchscreen ───────────┐
│  PWA (React/TS) ── IndexedDB (Dexie) ── Outbox      │
│        │                                           │
│        │  Service Worker (cache app shell)         │
└────────┼───────────────────────────────────────────┘
         │ HTTPS (pos.kikost.com)
         ▼
   Reverse proxy (Traefik) ── TLS Let's Encrypt
         │                         │
         │ Host=pos.kikost.com     │ PathPrefix=/api
         ▼                         ▼
   cafe-pos-web (nginx)     cafe-pos-api (Fastify)
                                   │
                                   ▼
                          cafe-pos-postgres (16)
                                   ▲
                          cafe-pos-backup (cron pg_dump)
```

Semua container POS berada pada Docker project `cafe-pos`, network internal
`cafe-pos-internal` (PostgreSQL tidak pernah menyentuh network `proxy` / internet).

## Model sinkronisasi

### Outbox (klien)

Setiap penulisan bisnis lokal mendaftarkan entri `syncQueue` **dalam transaksi Dexie
yang sama** (`src/sync/outbox.ts`) sehingga penulisan dan pendaftaran sync selalu atomik.
Entri memiliki `idempotencyKey` (UUID) sekali pakai.

### Push (`POST /api/sync/push`)

Batch item `{ entity, entityId, idempotencyKey, payload }`. Untuk tiap item, server:

1. **Idempotency** — bila `idempotencyKey` sudah pernah diproses, kembalikan hasil lama
   (`duplicate`/`rejected`), tidak menulis ulang. → *transaksi tidak pernah dobel.*
2. **Validasi** — entitas ada di allowlist; `payload.id === entityId`.
3. **Kunci baris** state (`SELECT … FOR UPDATE`) → aman terhadap batch paralel.
4. **Resolusi konflik** (`shouldApply`):
   - Last-write-wins berdasarkan `payload.updatedAt` (epoch ms).
   - **Proteksi pesanan final**: `orders` yang sudah `paid`/`void`/`completed` di server
     tidak pernah kembali ke `open`; hanya transisi final→final dengan timestamp lebih baru
     yang diterima (mendukung void/retur sah). → *transaksi dibayar tidak tertimpa.*
5. Upsert ke `sync_entity_state`, `server_seq` naik dari sequence global.
6. Catat `sync_idempotency`.

Konflik yang "kalah" LWW dikembalikan sebagai `duplicate` + alasan — klien menandai entri
`synced` (tidak retry) sementara state server dipertahankan.

### Pull (`GET /api/sync/pull?since=<seq>`)

Mengembalikan baris `sync_entity_state` dengan `server_seq > since` per entitas
(maks `SYNC_PULL_LIMIT`), plus `serverTime` = `server_seq` tertinggi. Klien menyimpan
`serverTime` di `localStorage` dan mengirimnya kembali di siklus berikut.

Klien menerapkan hasil pull dengan `applyRemoteEntities` (`src/sync/applyRemote.ts`),
yang juga tidak pernah menimpa pesanan lokal yang sudah final.

### Stok tidak berkurang dua kali

- Pengurangan stok terjadi **sekali**, saat `finalizePayment` (`src/db/repositories/checkout.ts`),
  di dalam satu transaksi Dexie bersama pembuatan `payments`, update `orders.status='paid'`,
  update meja, dan pendaftaran outbox.
- `finalizePayment` menolak bila `order.status !== 'open'` → klik ganda / pembayaran ulang
  tidak mengurangi stok lagi (`OrderAlreadyFinalizedError`).
- Server hanya menyimpan snapshot entitas; ia tidak menjalankan ulang logika stok, jadi
  replay push tidak dapat memotong stok lagi.
- `stockMovements` disinkronkan sebagai jejak audit (bukan sebagai perintah).

## Entitas yang disinkronkan

`orders, orderItems, payments, shifts, cashMovements, expenses, returns,
stockMovements, products, ingredients, categories, customers, auditLogs`

Daftar ini identik di `src/types/domain.ts` (`SyncEntity`) dan
`backend/src/lib/entities.ts` (`SYNC_ENTITIES`). Perubahan wajib di kedua sisi.

`settings`, `users`, `recipes`, `modifierGroups/Options`, `cafeTables` **tidak**
disinkronkan lewat API (dikelola per perangkat / lewat backup JSON lokal). Meja
disinkronkan tidak langsung melalui `orders`.

## Skema database server

Lihat `backend/migrations/001_init.sql`:

| Tabel | Fungsi |
|---|---|
| `sync_devices` | perangkat terdaftar (hash kunci, revocation) |
| `sync_entity_state` | state kanonik terkini per `(entity, entity_id)` + `server_seq` |
| `sync_idempotency` | satu baris per `idempotencyKey` yang pernah diproses |
| `sync_push_log` | ringkasan tiap batch push (observabilitas) |
| `schema_migrations` | migrasi yang sudah diterapkan |
