-- +migrate Up
-- Kode pasang tablet baru (dibuat developer di /ops). Tablet yang belum punya kunci
-- perangkat menukar kode ini di /api/pair → server membuat kunci perangkat baru khusus
-- tablet itu (sync_devices) dan Mode Developer terbuka. Satu kode aktif per tenant;
-- hanya hash yang disimpan.
CREATE TABLE device_pairing_codes (
  tenant_id      TEXT        PRIMARY KEY,
  code_hash      TEXT        NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  used_device_id UUID,
  -- 'used' | 'expired' | 'revoked'; NULL = aktif.
  closed_reason  TEXT
);

-- +migrate Down
DROP TABLE IF EXISTS device_pairing_codes;
