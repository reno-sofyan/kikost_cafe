-- +migrate Up
-- Halaman ulasan tamu (/ulasan/<orderId>) mencari order hanya dari id-nya — QR di
-- struk tidak memuat tenant. Primary key diawali tenant_id, jadi butuh indeks sendiri.
CREATE INDEX IF NOT EXISTS sync_entity_state_entity_id_idx ON sync_entity_state (entity, entity_id);

-- +migrate Down
DROP INDEX IF EXISTS sync_entity_state_entity_id_idx;
