-- +migrate Up
-- Kode pembatalan Pemilik yang dibuat dari konsol /ops (satu kode aktif per tenant).
-- Tablet mencocokkannya ke server saat kasir memasukkan kode yang tak cocok dengan
-- kode lokal; pencocokan yang berhasil langsung menghanguskannya (used_at).
-- Hanya hash yang disimpan.
CREATE TABLE owner_cancel_codes (
  tenant_id      TEXT        PRIMARY KEY,
  code_hash      TEXT        NOT NULL,
  salt           TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at        TIMESTAMPTZ,
  used_by_device TEXT
);

-- +migrate Down
DROP TABLE IF EXISTS owner_cancel_codes;
