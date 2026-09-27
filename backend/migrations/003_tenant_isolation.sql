-- +migrate Up
-- Satu backend dapat melayani beberapa usaha tanpa mencampur katalog, transaksi,
-- perangkat, QR, atau pembayaran. Data lama tetap berada pada tenant `default`.

ALTER TABLE sync_devices ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX sync_devices_tenant_idx ON sync_devices (tenant_id);

ALTER TABLE sync_entity_state ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sync_entity_state DROP CONSTRAINT sync_entity_state_pkey;
ALTER TABLE sync_entity_state ADD PRIMARY KEY (tenant_id, entity, entity_id);
CREATE INDEX sync_entity_state_tenant_seq_idx ON sync_entity_state (tenant_id, server_seq);
CREATE INDEX sync_entity_state_tenant_entity_seq_idx ON sync_entity_state (tenant_id, entity, server_seq);

ALTER TABLE sync_idempotency ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sync_idempotency DROP CONSTRAINT sync_idempotency_pkey;
ALTER TABLE sync_idempotency ADD PRIMARY KEY (tenant_id, idempotency_key);

ALTER TABLE sync_push_log ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE public_order_idempotency ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE public_order_idempotency DROP CONSTRAINT public_order_idempotency_pkey;
ALTER TABLE public_order_idempotency ADD PRIMARY KEY (tenant_id, idempotency_key);

ALTER TABLE public_request_log ADD COLUMN tenant_id TEXT;
CREATE INDEX public_request_log_tenant_created_idx ON public_request_log (tenant_id, created_at);

-- +migrate Down
-- Jangan rollback setelah ada data tenant selain `default`: penggabungan kembali
-- akan dapat menimpa primary key yang sama dari usaha yang berbeda.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sync_devices WHERE tenant_id <> 'default')
     OR EXISTS (SELECT 1 FROM sync_entity_state WHERE tenant_id <> 'default')
     OR EXISTS (SELECT 1 FROM sync_idempotency WHERE tenant_id <> 'default')
     OR EXISTS (SELECT 1 FROM sync_push_log WHERE tenant_id <> 'default')
     OR EXISTS (SELECT 1 FROM public_order_idempotency WHERE tenant_id <> 'default') THEN
    RAISE EXCEPTION 'Tidak dapat rollback tenant isolation selama data multi-tenant ada';
  END IF;
END $$;

DROP INDEX IF EXISTS public_request_log_tenant_created_idx;
ALTER TABLE public_request_log DROP COLUMN tenant_id;
ALTER TABLE public_order_idempotency DROP CONSTRAINT public_order_idempotency_pkey;
ALTER TABLE public_order_idempotency DROP COLUMN tenant_id;
ALTER TABLE public_order_idempotency ADD PRIMARY KEY (idempotency_key);
ALTER TABLE sync_push_log DROP COLUMN tenant_id;
ALTER TABLE sync_idempotency DROP CONSTRAINT sync_idempotency_pkey;
ALTER TABLE sync_idempotency DROP COLUMN tenant_id;
ALTER TABLE sync_idempotency ADD PRIMARY KEY (idempotency_key);
DROP INDEX IF EXISTS sync_entity_state_tenant_entity_seq_idx;
DROP INDEX IF EXISTS sync_entity_state_tenant_seq_idx;
ALTER TABLE sync_entity_state DROP CONSTRAINT sync_entity_state_pkey;
ALTER TABLE sync_entity_state DROP COLUMN tenant_id;
ALTER TABLE sync_entity_state ADD PRIMARY KEY (entity, entity_id);
DROP INDEX IF EXISTS sync_devices_tenant_idx;
ALTER TABLE sync_devices DROP COLUMN tenant_id;
