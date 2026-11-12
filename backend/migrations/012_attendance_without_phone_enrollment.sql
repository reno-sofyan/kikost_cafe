-- +migrate Up
-- Absen lewat HP tanpa mendaftarkan HP: karyawan memindai QR di tablet, memilih
-- namanya, lalu memasukkan PIN-nya sendiri (+ selfie). Lihat src/lib/staffAttendance.ts.

-- Daftar karyawan aktif yang dikirim tablet (kunci perangkat). Hanya hash PIN
-- PBKDF2 (sama dengan src/lib/pinHash.ts) yang disimpan, tidak pernah PIN-nya.
CREATE TABLE staff_attendance_roster (
  tenant_id       TEXT        NOT NULL,
  user_id         TEXT        NOT NULL,
  user_name       TEXT        NOT NULL,
  pin_hash        TEXT        NOT NULL,
  pin_salt        TEXT        NOT NULL,
  failed_attempts INTEGER     NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- QR kini memuat penanda tenant publik (acak, bukan id tenant) supaya server tahu
-- usaha mana yang dipindai tanpa HP terdaftar.
ALTER TABLE staff_attendance_secrets ADD COLUMN public_ref TEXT;
UPDATE staff_attendance_secrets SET public_ref = substr(md5(random()::text || tenant_id), 1, 10) WHERE public_ref IS NULL;
ALTER TABLE staff_attendance_secrets ALTER COLUMN public_ref SET NOT NULL;
CREATE UNIQUE INDEX staff_attendance_secrets_ref_idx ON staff_attendance_secrets (public_ref);

-- Tantangan tak lagi milik HP terdaftar; karyawan terikat setelah PIN-nya benar.
ALTER TABLE staff_punch_challenges ALTER COLUMN phone_id DROP NOT NULL;
ALTER TABLE staff_punch_challenges ADD COLUMN user_id TEXT;
ALTER TABLE staff_punch_challenges ADD COLUMN user_name TEXT;

ALTER TABLE staff_attendance_punches ALTER COLUMN phone_id DROP NOT NULL;
ALTER TABLE staff_attendance_punches ADD COLUMN device_label TEXT;

-- +migrate Down
ALTER TABLE staff_attendance_punches DROP COLUMN IF EXISTS device_label;
ALTER TABLE staff_punch_challenges DROP COLUMN IF EXISTS user_name;
ALTER TABLE staff_punch_challenges DROP COLUMN IF EXISTS user_id;
DROP INDEX IF EXISTS staff_attendance_secrets_ref_idx;
ALTER TABLE staff_attendance_secrets DROP COLUMN IF EXISTS public_ref;
DROP TABLE IF EXISTS staff_attendance_roster;
