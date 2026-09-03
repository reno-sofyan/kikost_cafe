-- +migrate Up
-- Fitur A: pemesanan mandiri via QR meja.
-- Endpoint publik menghitung total dari katalog di `sync_entity_state` (di-push
-- tablet) lalu MENULIS order/orderItems/bill kembali ke `sync_entity_state`
-- sehingga tablet menariknya lewat sinkronisasi biasa. Server TIDAK menjadi
-- sumber kebenaran bisnis untuk jalur kasir — hanya untuk order QR yang masuk.

-- Nomor pesanan QR: urutan global di server (tablet memakai KKP-xxxxx sendiri).
-- Format `QR<n>` TANPA tanda hubung sebelum digit supaya
-- `reconcileTransactionSequence` di klien (regex /-(\d+)$/) tidak ikut menaikkan
-- penghitung lokal KKP.
CREATE SEQUENCE IF NOT EXISTS qr_order_seq AS BIGINT START 1;

-- Idempotency submit pelanggan: satu Idempotency-Key → satu order, respons
-- disimpan untuk dikembalikan apa adanya pada pengiriman ulang.
CREATE TABLE public_order_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  token           TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  response        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX public_order_idempotency_created_idx ON public_order_idempotency (created_at);

-- Log ringkas permintaan publik (observabilitas + deteksi penyalahgunaan).
CREATE TABLE public_request_log (
  id         BIGSERIAL PRIMARY KEY,
  route      TEXT NOT NULL,
  token      TEXT,
  ip         TEXT,
  status     INTEGER NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX public_request_log_created_idx ON public_request_log (created_at);

-- +migrate Down
DROP TABLE IF EXISTS public_request_log;
DROP TABLE IF EXISTS public_order_idempotency;
DROP SEQUENCE IF EXISTS qr_order_seq;
