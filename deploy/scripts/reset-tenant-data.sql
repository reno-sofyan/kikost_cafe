-- Kosongkan SEMUA data tersinkron milik satu tenant (produk, pesanan, shift,
-- pengaturan, log, dll.) — mis. membuang data uji coba sebelum go-live.
--
-- TIDAK menyentuh `sync_devices` (pendaftaran kunci tablet), jadi tablet tetap
-- bisa sync tanpa didaftarkan ulang. Tenant lain tidak tersentuh.
--
-- Urutan aman: (1) hapus data app di SEMUA tablet tenant ini dulu, supaya tak
-- ada yang mendorong data lama lagi; (2) jalankan skrip ini; (3) onboarding
-- ulang di tablet.
--
-- Pakai (di container cafe-pos-postgres):
--   psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v tenant=<tenant_id> -f reset-tenant-data.sql
-- Tanpa -f: tempel isi berkas ini ke psql setelah `\set tenant <tenant_id>`.

\set ON_ERROR_STOP on

\echo 'Data yang akan dihapus untuk tenant' :'tenant'
SELECT entity, count(*) FROM sync_entity_state WHERE tenant_id = :'tenant' GROUP BY entity ORDER BY entity;

BEGIN;
DELETE FROM sync_entity_state       WHERE tenant_id = :'tenant';
DELETE FROM sync_push_log           WHERE tenant_id = :'tenant';
DELETE FROM sync_idempotency        WHERE tenant_id = :'tenant';
DELETE FROM public_order_idempotency WHERE tenant_id = :'tenant';
DELETE FROM public_request_log      WHERE tenant_id = :'tenant';
COMMIT;

\echo 'Selesai. Sisa baris tenant ini (harus 0):'
SELECT count(*) AS sisa FROM sync_entity_state WHERE tenant_id = :'tenant';
