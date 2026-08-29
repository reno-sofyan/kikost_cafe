-- +migrate Up
-- Skema inti sinkronisasi offline-first Kikost Cafe POS.
-- Server berperan sebagai relay multi-perangkat + sumber backup. Kebenaran bisnis
-- (total, stok, shift) dihitung di klien; server menyimpan state kanonik per entitas
-- dan menegakkan idempotency + proteksi transaksi final.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Kursor monotonik global untuk operasi pull inkremental.
CREATE SEQUENCE IF NOT EXISTS sync_server_seq AS BIGINT START 1;

-- Perangkat yang terdaftar untuk sinkronisasi. Kunci disimpan sebagai hash SHA-256 hex.
CREATE TABLE sync_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label          TEXT NOT NULL DEFAULT '',
  device_key_hash TEXT NOT NULL UNIQUE,
  revoked        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ
);

-- State kanonik terkini untuk setiap entitas yang disinkronkan.
CREATE TABLE sync_entity_state (
  entity            TEXT   NOT NULL,
  entity_id         TEXT   NOT NULL,
  payload           JSONB  NOT NULL,
  -- epoch milidetik dari payload.updatedAt / payload.createdAt milik klien (untuk LWW).
  entity_updated_at BIGINT NOT NULL,
  -- kursor server yang naik pada setiap perubahan; dipakai untuk pull inkremental.
  server_seq        BIGINT NOT NULL DEFAULT nextval('sync_server_seq'),
  deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  origin_device_id  UUID REFERENCES sync_devices(id) ON DELETE SET NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id)
);

CREATE INDEX sync_entity_state_seq_idx ON sync_entity_state (server_seq);
CREATE INDEX sync_entity_state_entity_seq_idx ON sync_entity_state (entity, server_seq);

-- Catatan idempotency: setiap idempotencyKey dari klien diproses tepat satu kali.
CREATE TABLE sync_idempotency (
  idempotency_key UUID PRIMARY KEY,
  entity          TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('accepted', 'duplicate', 'rejected')),
  detail          TEXT,
  device_id       UUID REFERENCES sync_devices(id) ON DELETE SET NULL,
  server_seq      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sync_idempotency_created_idx ON sync_idempotency (created_at);

-- Log ringkas setiap batch push untuk observabilitas & audit.
CREATE TABLE sync_push_log (
  id          BIGSERIAL PRIMARY KEY,
  device_id   UUID REFERENCES sync_devices(id) ON DELETE SET NULL,
  item_count  INTEGER NOT NULL,
  accepted    INTEGER NOT NULL DEFAULT 0,
  duplicate   INTEGER NOT NULL DEFAULT 0,
  rejected    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sync_push_log_created_idx ON sync_push_log (created_at);

-- +migrate Down
DROP TABLE IF EXISTS sync_push_log;
DROP TABLE IF EXISTS sync_idempotency;
DROP TABLE IF EXISTS sync_entity_state;
DROP TABLE IF EXISTS sync_devices;
DROP SEQUENCE IF EXISTS sync_server_seq;
