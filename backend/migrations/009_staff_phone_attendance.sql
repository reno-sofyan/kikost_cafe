-- +migrate Up
-- Absensi karyawan lewat HP sendiri (kafe). Lihat src/lib/staffAttendance.ts.
--
-- Bukti hadir = QR dinamis di tablet kasir (kode berganti tiap 20 detik, diturunkan
-- dari `secret` per tenant), HP terdaftar (kunci ECDSA yang tak bisa disalin keluar
-- dari browser), selfie, dan waktu dari server. Hasil absen ditulis ke
-- `sync_entity_state` sebagai entri `auditLogs` sehingga tablet menariknya lewat
-- sinkronisasi biasa dan rekap jam kerja/gaji tak perlu diubah.

-- Rahasia QR per tenant. Tablet mengambilnya (kunci perangkat) untuk menampilkan QR
-- walau sedang offline; server memakainya untuk memeriksa kode yang dipindai HP.
CREATE TABLE staff_attendance_secrets (
  tenant_id  TEXT        PRIMARY KEY,
  secret     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tautan pendaftaran HP sekali pakai, dibuat admin di tablet. Hanya hash yang disimpan.
CREATE TABLE staff_phone_enrollments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  TEXT        NOT NULL,
  user_id    TEXT        NOT NULL,
  user_name  TEXT        NOT NULL,
  token_hash TEXT        NOT NULL UNIQUE,
  created_by TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX staff_phone_enrollments_tenant_idx ON staff_phone_enrollments (tenant_id);

-- HP terdaftar. Satu HP aktif per karyawan; mendaftarkan HP baru mencabut yang lama.
CREATE TABLE staff_phones (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT        NOT NULL,
  user_id      TEXT        NOT NULL,
  user_name    TEXT        NOT NULL,
  public_key   JSONB       NOT NULL,
  label        TEXT        NOT NULL,
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX staff_phones_tenant_idx ON staff_phones (tenant_id);

-- Tantangan absen: dibuat saat HP menyerahkan kode QR yang masih segar, berlaku
-- beberapa menit (waktu untuk selfie), dan hangus setelah dipakai sekali.
CREATE TABLE staff_punch_challenges (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  TEXT        NOT NULL,
  phone_id   UUID        NOT NULL REFERENCES staff_phones (id),
  qr_window  BIGINT      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX staff_punch_challenges_phone_idx ON staff_punch_challenges (phone_id);

-- Absen lewat HP. `id` = id entri auditLogs yang ditulis ke sync_entity_state.
CREATE TABLE staff_attendance_punches (
  id          UUID             PRIMARY KEY,
  tenant_id   TEXT             NOT NULL,
  user_id     TEXT             NOT NULL,
  user_name   TEXT             NOT NULL,
  phone_id    UUID             NOT NULL REFERENCES staff_phones (id),
  type        TEXT             NOT NULL CHECK (type IN ('in', 'out')),
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
  selfie      BYTEA,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  accuracy_m  DOUBLE PRECISION,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX staff_attendance_punches_tenant_idx ON staff_attendance_punches (tenant_id, created_at DESC);

-- Ujung rantai hash entri auditLogs yang ditulis server (per tenant), sama seperti
-- rantai per perangkat di tablet (src/lib/auditLogIntegrity.ts).
CREATE TABLE staff_attendance_chain (
  tenant_id TEXT   PRIMARY KEY,
  seq       BIGINT NOT NULL,
  hash      TEXT   NOT NULL
);

-- +migrate Down
DROP TABLE IF EXISTS staff_attendance_chain;
DROP TABLE IF EXISTS staff_attendance_punches;
DROP TABLE IF EXISTS staff_punch_challenges;
DROP TABLE IF EXISTS staff_phones;
DROP TABLE IF EXISTS staff_phone_enrollments;
DROP TABLE IF EXISTS staff_attendance_secrets;
