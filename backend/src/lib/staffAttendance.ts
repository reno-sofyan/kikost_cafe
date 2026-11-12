import { createHash, createHmac, pbkdf2, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../db/pool.js'

/**
 * Absensi karyawan lewat HP (kafe) — tanpa mendaftarkan HP. Bukti absen:
 *  1. Hadir di tempat — HP harus menyerahkan kode QR yang sedang tampil di tablet kasir.
 *     Kode berganti tiap {@link QR_PERIOD_MS}; foto QR yang dikirim lewat chat cepat basi.
 *  2. PIN karyawan — karyawan memilih namanya lalu memasukkan PIN-nya sendiri. Tablet
 *     mengirim daftar karyawan aktif + hash PIN (PBKDF2, sama dengan src/lib/pinHash.ts);
 *     PIN salah berkali-kali mengunci nama itu sementara.
 *  3. Selfie — diambil langsung dari kamera (bukan galeri); wajib/opsional diatur admin.
 *  4. Waktu server — jam HP tidak dipakai sama sekali.
 *
 * Hasilnya ditulis ke `sync_entity_state` sebagai entri `auditLogs` (action
 * `attendance.in`/`attendance.out`, sama dengan absen di tablet) dengan rantai hash
 * milik server, jadi rekap jam kerja & gaji di tablet tidak perlu diubah.
 */

export const QR_PERIOD_MS = 20_000
/** Jendela QR yang diterima: 3 jendela ke belakang (±60 dtk, jeda memindai) dan 1 ke depan (jam tablet sedikit maju). */
const QR_WINDOWS_BACK = 3
const QR_WINDOWS_AHEAD = 1
/** Waktu untuk memilih nama, PIN, dan selfie setelah QR dipindai. */
const CHALLENGE_TTL_MS = 3 * 60_000
/** Sama dengan `MAX_SESSION_MS` di src/db/repositories/attendance.ts. */
const MAX_SESSION_MS = 16 * 60 * 60 * 1000
const MAX_SELFIE_BYTES = 400 * 1024
/** PIN salah sebanyak ini → nama karyawan itu dikunci {@link PIN_LOCK_MS}. */
export const MAX_PIN_ATTEMPTS = 5
const PIN_LOCK_MS = 15 * 60_000
/** Sama dengan `PBKDF2_ITERATIONS` di src/lib/pinHash.ts. */
const PBKDF2_ITERATIONS = 150_000
/** `deviceId` entri auditLogs yang ditulis server — rantai hash terpisah dari tablet. */
export const SERVER_CHAIN_DEVICE_ID = 'server:absen-hp'

const ACTIONS_IN = ['attendance.in', 'attendance.manual_in']
const ACTIONS_ALL = ['attendance.in', 'attendance.out', 'attendance.manual_in', 'attendance.manual_out']

const pbkdf2Async = promisify(pbkdf2)

export class AttendanceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'AttendanceError'
  }
}

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

// ---- Kode QR dinamis ----

export async function getQrSecret(pool: Pool | PoolClient, tenantId: string): Promise<{ secret: string; ref: string }> {
  await pool.query('INSERT INTO staff_attendance_secrets (tenant_id, secret, public_ref) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO NOTHING', [
    tenantId,
    randomBytes(32).toString('base64url'),
    randomBytes(8).toString('hex').slice(0, 10),
  ])
  const { rows } = await pool.query<{ secret: string; public_ref: string }>('SELECT secret, public_ref FROM staff_attendance_secrets WHERE tenant_id = $1', [tenantId])
  return { secret: rows[0].secret, ref: rows[0].public_ref }
}

/** Kode untuk satu jendela waktu. HARUS identik dengan `attendanceQrCode` di src/lib/attendanceQr.ts. */
export function qrCodeFor(secret: string, window: number): string {
  return createHmac('sha256', secret).update(`absen:${window}`).digest('base64url').slice(0, 12)
}

/** Isi QR `<ref>.<jendela>.<kode>` → bagian-bagiannya, atau `null` bila bentuknya salah. */
export function parseQr(qr: string): { ref: string; window: number; code: string } | null {
  const m = /^([0-9a-f]{10})\.(\d{1,15})\.([A-Za-z0-9_-]{12})$/.exec(qr)
  return m ? { ref: m[1], window: Number(m[2]), code: m[3] } : null
}

/** Memeriksa jendela + kode QR; mengembalikan jendelanya bila sah dan masih segar. */
export function checkQr(secret: string, window: number, code: string, now = Date.now()): number | null {
  const current = Math.floor(now / QR_PERIOD_MS)
  if (window < current - QR_WINDOWS_BACK || window > current + QR_WINDOWS_AHEAD) return null
  const expected = Buffer.from(qrCodeFor(secret, window))
  const given = Buffer.from(code)
  return expected.length === given.length && timingSafeEqual(expected, given) ? window : null
}

// ---- Daftar karyawan (dikirim tablet) ----

export interface RosterInput {
  userId: string
  userName: string
  pinHash: string
  pinSalt: string
}

/**
 * Mengganti daftar karyawan tenant dengan kiriman tablet. Hitungan PIN salah & kunci
 * sementara dipertahankan selama PIN-nya tidak berubah; karyawan yang tak lagi aktif dihapus.
 */
export async function replaceRoster(tenantId: string, staff: RosterInput[]): Promise<number> {
  return withTransaction(async (client) => {
    const ids = staff.map((s) => s.userId)
    await client.query('DELETE FROM staff_attendance_roster WHERE tenant_id = $1 AND NOT (user_id = ANY($2))', [tenantId, ids])
    for (const s of staff) {
      await client.query(
        `INSERT INTO staff_attendance_roster (tenant_id, user_id, user_name, pin_hash, pin_salt)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET
           user_name = EXCLUDED.user_name,
           failed_attempts = CASE WHEN staff_attendance_roster.pin_hash = EXCLUDED.pin_hash THEN staff_attendance_roster.failed_attempts ELSE 0 END,
           locked_until = CASE WHEN staff_attendance_roster.pin_hash = EXCLUDED.pin_hash THEN staff_attendance_roster.locked_until ELSE NULL END,
           pin_hash = EXCLUDED.pin_hash,
           pin_salt = EXCLUDED.pin_salt,
           updated_at = now()`,
        [tenantId, s.userId, s.userName, s.pinHash, s.pinSalt],
      )
    }
    return staff.length
  })
}

async function pinMatches(pin: string, saltHex: string, expectedHex: string): Promise<boolean> {
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false
  const derived = await pbkdf2Async(pin, Buffer.from(saltHex, 'hex'), PBKDF2_ITERATIONS, 32, 'sha256')
  return timingSafeEqual(derived, Buffer.from(expectedHex, 'hex'))
}

// ---- Absen ----

async function businessName(client: Pool | PoolClient, tenantId: string): Promise<string> {
  const { rows } = await client.query<{ name: string | null }>(
    "SELECT payload->>'businessName' AS name FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton'",
    [tenantId],
  )
  return rows[0]?.name?.trim() || 'Kione POS'
}

/** Pengaturan admin di tablet (`AppSettings.attendancePhoneSelfie`); bawaan = wajib. */
export async function selfieRequired(client: Pool | PoolClient, tenantId: string): Promise<boolean> {
  const { rows } = await client.query<{ v: string | null }>(
    "SELECT payload->>'attendancePhoneSelfie' AS v FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton'",
    [tenantId],
  )
  return rows[0]?.v !== 'optional'
}

/** Absen terakhir karyawan (dari tablet maupun HP): masih bekerja sejak kapan, atau `null`. */
async function clockedInSince(client: Pool | PoolClient, tenantId: string, userId: string, now: number): Promise<number | null> {
  const { rows } = await client.query<{ action: string; at: string }>(
    `SELECT payload->>'action' AS action, payload->>'createdAt' AS at FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'auditLogs' AND payload->>'entityType' = 'attendance' AND payload->>'entityId' = $2
        AND payload->>'action' = ANY($3) AND (payload->>'createdAt')::bigint > $4
      ORDER BY (payload->>'createdAt')::bigint DESC LIMIT 1`,
    [tenantId, userId, ACTIONS_ALL, now - MAX_SESSION_MS],
  )
  const last = rows[0]
  return last && ACTIONS_IN.includes(last.action) ? Number(last.at) : null
}

export interface StartResult {
  challengeId: string
  businessName: string
  selfieRequired: boolean
  staff: { userId: string; userName: string }[]
  expiresAt: number
}

/** Langkah 1: HP menyerahkan QR yang baru dipindai → sesi absen + daftar nama karyawan. */
export async function startPunch(pool: Pool, qr: string): Promise<StartResult> {
  const parsed = parseQr(qr)
  if (!parsed) throw new AttendanceError('Isi QR tidak valid. Pindai QR absensi di tablet kasir.')
  const { rows: tenants } = await pool.query<{ tenant_id: string; secret: string }>('SELECT tenant_id, secret FROM staff_attendance_secrets WHERE public_ref = $1', [parsed.ref])
  const tenant = tenants[0]
  const window = tenant ? checkQr(tenant.secret, parsed.window, parsed.code) : null
  if (!tenant || window == null) throw new AttendanceError('QR sudah kedaluwarsa. Pindai lagi QR yang sedang tampil di tablet kasir.', 409)

  const { rows: staff } = await pool.query<{ user_id: string; user_name: string }>('SELECT user_id, user_name FROM staff_attendance_roster WHERE tenant_id = $1 ORDER BY user_name', [tenant.tenant_id])
  if (staff.length === 0) throw new AttendanceError('Daftar karyawan belum dikirim dari tablet. Minta admin membuka menu Absensi di tablet kasir saat online.', 409)
  const expiresAt = Date.now() + CHALLENGE_TTL_MS
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO staff_punch_challenges (tenant_id, qr_window, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0)) RETURNING id',
    [tenant.tenant_id, window, expiresAt],
  )
  return {
    challengeId: rows[0].id,
    businessName: await businessName(pool, tenant.tenant_id),
    selfieRequired: await selfieRequired(pool, tenant.tenant_id),
    staff: staff.map((s) => ({ userId: s.user_id, userName: s.user_name })),
    expiresAt,
  }
}

export interface IdentifyResult {
  type: 'in' | 'out'
  userName: string
  clockedInSince: number | null
}

const CHALLENGE_ID_RE = /^[0-9a-f-]{36}$/i

/** Langkah 2: karyawan memilih namanya + PIN → sesi absen terikat ke karyawan itu. */
export async function identifyStaff(input: { challengeId: string; userId: string; pin: string }): Promise<IdentifyResult> {
  if (!CHALLENGE_ID_RE.test(input.challengeId)) throw new AttendanceError('Sesi absen tidak dikenal. Pindai QR lagi.', 404)
  // PIN salah dikembalikan (bukan dilempar) dari transaksi supaya hitungan percobaannya ikut tersimpan.
  const result = await withTransaction(async (client): Promise<IdentifyResult | AttendanceError> => {
    const ch = (
      await client.query<{ tenant_id: string; expired: boolean; used: boolean }>(
        'SELECT tenant_id, expires_at < now() AS expired, used_at IS NOT NULL AS used FROM staff_punch_challenges WHERE id = $1 FOR UPDATE',
        [input.challengeId],
      )
    ).rows[0]
    if (!ch) throw new AttendanceError('Sesi absen tidak dikenal. Pindai QR lagi.', 404)
    if (ch.used) throw new AttendanceError('Sesi absen ini sudah dipakai. Pindai QR lagi.', 409)
    if (ch.expired) throw new AttendanceError('Waktu absen habis. Pindai QR lagi.', 409)

    const staff = (
      await client.query<{ user_name: string; pin_hash: string; pin_salt: string; failed_attempts: number; locked: boolean; locked_min: number | null }>(
        `SELECT user_name, pin_hash, pin_salt, failed_attempts, locked_until > now() AS locked,
                CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60)::int AS locked_min
           FROM staff_attendance_roster WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
        [ch.tenant_id, input.userId],
      )
    ).rows[0]
    if (!staff) throw new AttendanceError('Nama karyawan tidak ditemukan. Pindai QR lagi.', 404)
    if (staff.locked) throw new AttendanceError(`PIN salah terlalu sering. Coba lagi ${staff.locked_min ?? 15} menit lagi atau minta absen manual ke admin.`, 429)

    if (!(await pinMatches(input.pin, staff.pin_salt, staff.pin_hash))) {
      const attempts = staff.failed_attempts + 1
      const lock = attempts >= MAX_PIN_ATTEMPTS
      await client.query(
        `UPDATE staff_attendance_roster SET failed_attempts = $3, locked_until = CASE WHEN $4 THEN now() + ($5 || ' milliseconds')::interval ELSE locked_until END
          WHERE tenant_id = $1 AND user_id = $2`,
        [ch.tenant_id, input.userId, lock ? 0 : attempts, lock, String(PIN_LOCK_MS)],
      )
      return new AttendanceError(lock ? 'PIN salah terlalu sering. Nama ini dikunci 15 menit.' : `PIN salah. Sisa ${MAX_PIN_ATTEMPTS - attempts} kali percobaan.`, lock ? 429 : 401)
    }
    await client.query('UPDATE staff_attendance_roster SET failed_attempts = 0, locked_until = NULL WHERE tenant_id = $1 AND user_id = $2', [ch.tenant_id, input.userId])
    await client.query('UPDATE staff_punch_challenges SET user_id = $2, user_name = $3 WHERE id = $1', [input.challengeId, input.userId, staff.user_name])
    const since = await clockedInSince(client, ch.tenant_id, input.userId, Date.now())
    return { type: since != null ? 'out' : 'in', userName: staff.user_name, clockedInSince: since }
  })
  if (result instanceof AttendanceError) throw result
  return result
}

export interface PunchLocation {
  latitude: number
  longitude: number
  accuracy: number
}

export interface PunchResult {
  type: 'in' | 'out'
  at: number
  userName: string
  minutes: number
}

/** Bentuk kanonik entri auditLogs yang di-hash. HARUS identik dengan `canonicalEntryText` di src/lib/auditLogIntegrity.ts. */
export function auditEntryHash(entry: {
  id: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  details: string
  createdAt: number
  deviceId: string
  deviceSeq: number
  prevHash: string | null
}): string {
  return sha256Hex(
    JSON.stringify({
      id: entry.id,
      userId: entry.userId,
      userName: entry.userName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details,
      createdAt: entry.createdAt,
      deviceId: entry.deviceId,
      deviceSeq: entry.deviceSeq,
      prevHash: entry.prevHash,
    }),
  )
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} jam ${m} mnt` : `${m} mnt`
}

/** Label singkat HP dari user-agent untuk catatan absen, mis. "Android · Chrome". */
export function deviceLabel(ua: string | null): string {
  const s = ua ?? ''
  const os = /iPhone|iPad/.test(s) ? 'iPhone' : /Android/.test(s) ? 'Android' : 'HP'
  const browser = /SamsungBrowser/.test(s) ? 'Samsung Internet' : /CriOS|Chrome/.test(s) ? 'Chrome' : /Firefox|FxiOS/.test(s) ? 'Firefox' : /Safari/.test(s) ? 'Safari' : 'Browser'
  return `${os} · ${browser}`
}

/** Langkah 3: selfie (+ lokasi bila diizinkan) → absen tercatat. */
export async function completePunch(input: {
  challengeId: string
  selfieBase64: string | null
  location: PunchLocation | null
  ip: string | null
  userAgent: string | null
}): Promise<PunchResult> {
  const selfie = input.selfieBase64 ? Buffer.from(input.selfieBase64, 'base64') : null
  if (selfie && (selfie.length > MAX_SELFIE_BYTES || selfie[0] !== 0xff || selfie[1] !== 0xd8)) throw new AttendanceError('Foto selfie tidak valid.')
  if (!CHALLENGE_ID_RE.test(input.challengeId)) throw new AttendanceError('Sesi absen tidak dikenal. Pindai QR lagi.', 404)

  return withTransaction(async (client) => {
    const ch = (
      await client.query<{ tenant_id: string; user_id: string | null; user_name: string | null; expired: boolean; used: boolean }>(
        'SELECT tenant_id, user_id, user_name, expires_at < now() AS expired, used_at IS NOT NULL AS used FROM staff_punch_challenges WHERE id = $1 FOR UPDATE',
        [input.challengeId],
      )
    ).rows[0]
    if (!ch) throw new AttendanceError('Sesi absen tidak dikenal. Pindai QR lagi.', 404)
    if (ch.used) throw new AttendanceError('Sesi absen ini sudah dipakai. Pindai QR lagi.', 409)
    if (ch.expired) throw new AttendanceError('Waktu selfie habis. Pindai QR lagi.', 409)
    if (!ch.user_id || !ch.user_name) throw new AttendanceError('Pilih nama dan masukkan PIN dulu.', 401)
    if (!selfie && (await selfieRequired(client, ch.tenant_id))) throw new AttendanceError('Selfie wajib untuk absen.')
    await client.query('UPDATE staff_punch_challenges SET used_at = now() WHERE id = $1', [input.challengeId])
    const tenantId = ch.tenant_id
    const userId = ch.user_id
    const userName = ch.user_name

    // Kunci ujung rantai tenant ini → absen serentak tetap berurutan & arah masuk/pulang konsisten.
    await client.query('INSERT INTO staff_attendance_chain (tenant_id, seq, hash) VALUES ($1, 0, $2) ON CONFLICT (tenant_id) DO NOTHING', [tenantId, ''])
    const head = (await client.query<{ seq: string; hash: string }>('SELECT seq, hash FROM staff_attendance_chain WHERE tenant_id = $1 FOR UPDATE', [tenantId])).rows[0]

    const at = Date.now()
    const since = await clockedInSince(client, tenantId, userId, at)
    const type: 'in' | 'out' = since != null ? 'out' : 'in'
    const minutes = since != null ? Math.round((at - since) / 60000) : 0
    const label = deviceLabel(input.userAgent)
    const via = `lewat HP (${label}, PIN${selfie ? ', selfie' : ', tanpa selfie'}${input.location ? '' : ', tanpa lokasi'})`
    const id = randomUUID()
    const seq = Number(head.seq) + 1
    const entryBase = {
      id,
      userId,
      userName,
      action: type === 'in' ? 'attendance.in' : 'attendance.out',
      entityType: 'attendance',
      entityId: userId,
      details: type === 'in' ? `${userName} absen masuk ${via}.` : `${userName} absen pulang setelah ${formatMinutes(minutes)} ${via}.`,
      createdAt: at,
      deviceId: SERVER_CHAIN_DEVICE_ID,
      deviceSeq: seq,
      prevHash: head.hash || null,
    }
    const entry = { ...entryBase, hash: auditEntryHash(entryBase) }

    await client.query(
      `INSERT INTO staff_attendance_punches (id, tenant_id, user_id, user_name, device_label, type, created_at, selfie, latitude, longitude, accuracy_m, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10, $11, $12, $13)`,
      [id, tenantId, userId, userName, label, type, at, selfie, input.location?.latitude ?? null, input.location?.longitude ?? null, input.location?.accuracy ?? null, input.ip, input.userAgent?.slice(0, 300) ?? null],
    )
    await client.query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
       VALUES ($1, 'auditLogs', $2, $3::jsonb, $4, nextval('sync_server_seq'), now())`,
      [tenantId, id, JSON.stringify(entry), at],
    )
    await client.query('UPDATE staff_attendance_chain SET seq = $2, hash = $3 WHERE tenant_id = $1', [tenantId, seq, entry.hash])
    return { type, at, userName, minutes }
  })
}

// ---- Konsol Pemilik ----

export interface AttendanceLogRow {
  id: string
  userName: string
  type: 'in' | 'out'
  /** 'phone' = lewat HP; 'manual' = dicatat admin di tablet (pengecualian); 'pin' = absen PIN lama di tablet. */
  source: 'phone' | 'manual' | 'pin'
  createdAt: number
  details: string
  phoneLabel: string | null
  hasSelfie: boolean
  location: PunchLocation | null
}

/** Semua absen dalam rentang — dari HP (lengkap dengan selfie/lokasi) maupun dari tablet. */
export async function loadAttendanceLog(pool: Pool, tenantId: string, sinceMs: number, untilMs: number): Promise<{ rows: AttendanceLogRow[] }> {
  const [punches, logs] = await Promise.all([
    pool.query<{ id: string; label: string | null; has_selfie: boolean; latitude: number | null; longitude: number | null; accuracy_m: number | null }>(
      `SELECT p.id, COALESCE(p.device_label, ph.label) AS label, p.selfie IS NOT NULL AS has_selfie, p.latitude, p.longitude, p.accuracy_m
         FROM staff_attendance_punches p LEFT JOIN staff_phones ph ON ph.id = p.phone_id
        WHERE p.tenant_id = $1 AND p.created_at >= to_timestamp($2 / 1000.0) AND p.created_at <= to_timestamp($3 / 1000.0)`,
      [tenantId, sinceMs, untilMs],
    ),
    pool.query<{ payload: { id: string; userName: string; action: string; details: string; createdAt: number; deviceId: string | null } }>(
      `SELECT payload FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'auditLogs' AND payload->>'entityType' = 'attendance' AND payload->>'action' = ANY($2)
          AND (payload->>'createdAt')::bigint BETWEEN $3 AND $4`,
      [tenantId, ACTIONS_ALL, sinceMs, untilMs],
    ),
  ])
  const byId = new Map(punches.rows.map((p) => [p.id, p]))
  const rows = logs.rows
    .map(({ payload: e }): AttendanceLogRow => {
      const p = byId.get(e.id)
      return {
        id: e.id,
        userName: e.userName,
        type: e.action.endsWith('in') ? 'in' : 'out',
        source: p ? 'phone' : e.action.startsWith('attendance.manual_') ? 'manual' : 'pin',
        createdAt: Number(e.createdAt),
        details: e.details,
        phoneLabel: p?.label ?? null,
        hasSelfie: p?.has_selfie ?? false,
        location: p && p.latitude != null && p.longitude != null ? { latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy_m ?? 0 } : null,
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
  return { rows }
}

export async function loadSelfie(pool: Pool, tenantId: string, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { rows } = await pool.query<{ selfie: Buffer | null }>('SELECT selfie FROM staff_attendance_punches WHERE tenant_id = $1 AND id = $2', [tenantId, id])
  return rows[0]?.selfie ?? null
}
