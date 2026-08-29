# API Sinkronisasi (ringkas)

Spesifikasi mesin: [`backend/openapi.yaml`](../backend/openapi.yaml) (OpenAPI 3.1).

Base URL produksi: `https://pos.kikost.com` — semua endpoint di bawah `/api`.

## Autentikasi

Semua endpoint `/api/sync/*` butuh header:

```
Authorization: Bearer <kunci-perangkat>
```

Kunci sah bila ada di env `SYNC_DEVICE_KEYS` (dipisah koma) atau baris aktif di
tabel `sync_devices`. Buat kunci: `openssl rand -hex 32`.

## Endpoint

### `GET /api/health`
Tanpa auth. `200` `{ status:"ok", db:"ok", latencyMs, time }`; `503` bila DB down.

### `GET /api/health/live`
Tanpa auth. Liveness proses saja.

### `POST /api/sync/push`
Body:
```json
{
  "deviceId": "uuid-perangkat",
  "items": [
    { "entity": "orders", "entityId": "<uuid>", "idempotencyKey": "<uuid>", "payload": { "id": "<uuid>", "updatedAt": 1730000000000, "...": "..." } }
  ]
}
```
Respons `200`:
```json
{ "results": [ { "idempotencyKey": "<uuid>", "status": "accepted|duplicate|rejected", "error": "opsional" } ], "serverTime": 42 }
```
- `accepted` — diterapkan ke state kanonik.
- `duplicate` — key sudah diproses **atau** kalah last-write-wins / diblok proteksi
  pesanan final. Klien menandai entri outbox `synced` (tidak perlu retry).
- `rejected` — payload/entitas tidak valid. Klien menandai `failed`.

Maks `SYNC_MAX_BATCH` (200) item/permintaan.

### `GET /api/sync/pull?since=<serverTime>`
Respons `200`:
```json
{ "entities": { "orders": [ {…} ], "products": [ {…} ] }, "serverTime": 99 }
```
Kembalikan hanya baris dengan `server_seq > since` per entitas (maks `SYNC_PULL_LIMIT`).
Simpan `serverTime` dan kirim sebagai `since` berikutnya.

## Kode status

| Kode | Arti |
|---|---|
| 400 | Body/query tidak valid |
| 401 | Kunci perangkat tidak ada / salah |
| 413 | Batch terlalu besar |
| 429 | Rate limit (`RATE_LIMIT_MAX`/menit/IP) |
| 503 | Database tidak terjangkau (health) |

## Entitas yang disinkronkan

`orders, orderItems, payments, shifts, cashMovements, expenses, returns,
stockMovements, products, ingredients, categories, customers, auditLogs`

## Jaminan

- **Idempoten** — `idempotencyKey` UUID unik per operasi; replay tidak menduplikasi.
- **Transaksi final aman** — `orders` berstatus `paid/void/completed` tidak pernah
  dikembalikan ke `open`.
- **Last-write-wins** — per `payload.updatedAt` (epoch ms).
- **Atomik per batch** — satu transaksi PostgreSQL per `push`.
