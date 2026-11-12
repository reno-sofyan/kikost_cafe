-- +migrate Up
-- Token Mode Developer: 4 angka, sekali pakai, dibuat dari konsol /ops. Membuka
-- pengaturan teknis di tablet (Sinkronisasi, Pulihkan Backup, penyedia QRIS, Pager,
-- Barcode Timbangan). Satu token aktif per tenant; hanya hash yang disimpan.
CREATE TABLE developer_access_codes (
  tenant_id      TEXT        PRIMARY KEY,
  code_hash      TEXT        NOT NULL,
  salt           TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  failed_count   INTEGER     NOT NULL DEFAULT 0,
  used_at        TIMESTAMPTZ,
  used_by_device TEXT,
  -- 'used' | 'expired' | 'burned' (terlalu banyak salah) | 'revoked'; NULL = aktif.
  closed_reason  TEXT
);

-- +migrate Down
DROP TABLE IF EXISTS developer_access_codes;
