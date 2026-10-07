-- +migrate Up
-- QRIS dinamis Midtrans yang dibuat dari kasir (tablet). Dicatat di server supaya
-- notifikasi Midtrans / cek status tahu tenant, order, & bill pemiliknya walau
-- pesanan itu belum sempat tersinkron dari tablet.
CREATE TABLE midtrans_charges (
  midtrans_order_id TEXT PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  order_id          TEXT        NOT NULL,
  bill_id           TEXT        NOT NULL,
  gross_amount      INTEGER     NOT NULL CHECK (gross_amount > 0),
  device_id         TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending',
  transaction_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX midtrans_charges_tenant_order_idx ON midtrans_charges (tenant_id, order_id);

-- +migrate Down
DROP TABLE IF EXISTS midtrans_charges;
