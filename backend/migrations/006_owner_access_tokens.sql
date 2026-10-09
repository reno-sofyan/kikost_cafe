-- +migrate Up
-- Akses konsol Pemilik (/owner): tautan berisi token acak yang dibuat developer di
-- /ops dan diberikan ke pemilik usaha. Satu token = satu tenant; boleh lebih dari
-- satu per tenant (mis. HP & laptop Pemilik) dan bisa dicabut satu per satu.
-- Hanya hash SHA-256 yang disimpan (token 32 byte acak — entropi cukup tanpa salt).
CREATE TABLE owner_access_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT        NOT NULL,
  token_hash   TEXT        NOT NULL UNIQUE,
  label        TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX owner_access_tokens_tenant_idx ON owner_access_tokens (tenant_id);

-- +migrate Down
DROP TABLE IF EXISTS owner_access_tokens;
