-- Kosongkan SEMUA data absensi karyawan di SEMUA tenant — mis. membuang data uji coba.
-- Yang dihapus: absen lewat HP (+ selfie & lokasi), absen manual/PIN dari tablet
-- (entri auditLogs `attendance.*`), sesi absen, dan sisa pendaftaran HP lama.
--
-- TIDAK dihapus: daftar karyawan + hash PIN (`staff_attendance_roster`), rahasia QR,
-- dan ujung rantai hash server (`staff_attendance_chain`, supaya absen baru tetap
-- menyambung ke entri yang masih tersimpan di tablet). Pengaturan & log lain tak tersentuh.
--
-- Catatan: tablet menyimpan salinan absensinya sendiri. Rekap di tablet baru ikut
-- kosong bila data aplikasi tablet dihapus; tablet yang DIPASANGKAN ULANG akan
-- mengirim ulang semua datanya, termasuk absen lama.
--
-- Pakai (di container cafe-pos-postgres):
--   psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f reset-attendance.sql
-- Tanpa -f: tempel isi berkas ini ke psql.

\set ON_ERROR_STOP on

\echo 'Data absensi yang akan dihapus per tenant:'
SELECT tenant_id, payload->>'action' AS jenis, count(*) FROM sync_entity_state
 WHERE entity = 'auditLogs' AND payload->>'entityType' = 'attendance' AND payload->>'action' LIKE 'attendance.%'
 GROUP BY 1, 2 ORDER BY 1, 2;
SELECT tenant_id, count(*) AS absen_hp, count(selfie) AS selfie FROM staff_attendance_punches GROUP BY 1 ORDER BY 1;

BEGIN;
DELETE FROM sync_entity_state
 WHERE entity = 'auditLogs' AND payload->>'entityType' = 'attendance'
   AND payload->>'action' IN ('attendance.in', 'attendance.out', 'attendance.manual_in', 'attendance.manual_out');
DELETE FROM staff_attendance_punches;
DELETE FROM staff_punch_challenges;
DELETE FROM staff_phones;
DELETE FROM staff_phone_enrollments;
COMMIT;

\echo 'Selesai. Sisa (harus 0 semua):'
SELECT
  (SELECT count(*) FROM sync_entity_state WHERE entity = 'auditLogs' AND payload->>'entityType' = 'attendance'
     AND payload->>'action' IN ('attendance.in', 'attendance.out', 'attendance.manual_in', 'attendance.manual_out')) AS log_absen,
  (SELECT count(*) FROM staff_attendance_punches) AS absen_hp;
