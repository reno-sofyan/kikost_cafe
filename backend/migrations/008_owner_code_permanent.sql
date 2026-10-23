-- +migrate Up
-- Kode pembatalan Pemilik bisa "selamanya": dipakai berulang sampai dihapus atau
-- diganti. Kode sekali pakai tetap seperti semula (used_at diisi saat dipakai).
ALTER TABLE owner_cancel_codes ADD COLUMN permanent    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE owner_cancel_codes ADD COLUMN use_count    INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE owner_cancel_codes ADD COLUMN last_used_at TIMESTAMPTZ;

-- +migrate Down
ALTER TABLE owner_cancel_codes DROP COLUMN last_used_at;
ALTER TABLE owner_cancel_codes DROP COLUMN use_count;
ALTER TABLE owner_cancel_codes DROP COLUMN permanent;
