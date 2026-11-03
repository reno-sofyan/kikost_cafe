import { createHash, createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify, type KeyObject } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../db/pool.js'

/**
 * Absensi karyawan lewat HP sendiri (kafe). Empat lapis bukti:
 *  1. HP terdaftar — HP membuat pasangan kunci ECDSA P-256 yang tak bisa diekspor dari
 *     browser; server hanya menyimpan kunci publiknya. Pendaftaran lewat tautan sekali
 *     pakai yang dibuat admin di tablet, jadi admin yang menyetujui HP mana yang sah.
 *  2. Hadir di tempat — HP harus menyerahkan kode QR yang sedang tampil di tablet kasir.
 *     Kode berganti tiap {@link QR_PERIOD_MS}; foto QR yang dikirim lewat chat cepat basi.
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
/** Waktu untuk selfie setelah QR dipindai. */
const CHALLENGE_TTL_MS = 3 * 60_000
const ENROLL_TTL_MS = 15 * 60_000
/** Sama dengan `MAX_SESSION_MS` di src/db/repositories/attendance.ts. */
const MAX_SESSION_MS = 16 * 60 * 60 * 1000
const MAX_SELFIE_BYTES = 400 * 1024
/** `deviceId` entri auditLogs yang ditulis server — rantai hash terpisah dari tablet. */
export const SERVER_CHAIN_DEVICE_ID = 'server:absen-hp'

const ACTIONS_IN = ['attendance.in', 'attendance.manual_in']
const ACTIONS_ALL = ['attendance.in', 'attendance.out', 'attendance.manual_in', 'attendance.manual_out']

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

export async function getQrSecret(pool: Pool | PoolClient, tenantId: string): Promise<string> {
  const fresh = randomBytes(32).toString('base64url')
  await pool.query('INSERT INTO staff_attendance_secrets (tenant_id, secret) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING', [tenantId, fresh])
  const { rows } = await pool.query<{ secret: string }>('SELECT secret FROM staff_attendance_secrets WHERE tenant_id = $1', [tenantId])
  return rows[0].secret
}

/** Kode untuk satu jendela waktu. HARUS identik dengan `attendanceQrCode` di src/lib/attendanceQr.ts. */
export function qrCodeFor(secret: string, window: number): string {
  return createHmac('sha256', secret).update(`absen:${window}`).digest('base64url').slice(0, 12)
}

/** Memeriksa isi QR `<jendela>.<kode>`; mengembalikan jendelanya bila sah dan masih segar. */
export function checkQr(secret: string, qr: string, now = Date.now()): number | null {
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{12})$/.exec(qr)
  if (!m) return null
  const window = Number(m[1])
  const current = Math.floor(now / QR_PERIOD_MS)
  if (window < current - QR_WINDOWS_BACK || window > current + QR_WINDOWS_AHEAD) return null
  const expected = Buffer.from(qrCodeFor(secret, window))
  const given = Buffer.from(m[2])
  return expected.length === given.length && timingSafeEqual(expected, given) ? window : null
}

// ---- Pendaftaran HP ----

export async function createEnrollment(pool: Pool, tenantId: string, input: { userId: string; userName: string; createdBy: string }): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(24).toString('base64url')
  const expiresAt = Date.now() + ENROLL_TTL_MS
  await pool.query(
    `INSERT INTO staff_phone_enrollments (tenant_id, user_id, user_name, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
    [tenantId, input.userId, input.userName, sha256Hex(token), input.createdBy, expiresAt],
  )
  return { token, expiresAt }
}

/** Kunci publik ECDSA P-256 dalam bentuk JWK — hanya field yang dibutuhkan yang disimpan. */
export function parsePublicJwk(raw: unknown): { kty: 'EC'; crv: 'P-256'; x: string; y: string } | null {
  const j = raw as Record<string, unknown> | null
  if (!j || j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string') return null
  const jwk = { kty: 'EC' as const, crv: 'P-256' as const, x: j.x, y: j.y }
  try {
    createPublicKey({ key: jwk, format: 'jwk' })
    return jwk
  } catch {
    return null
  }
}

export async function completeEnrollment(
  token: string,
  publicKey: unknown,
  label: string,
): Promise<{ phoneId: string; userName: string; businessName: string }> {
  const jwk = parsePublicJwk(publicKey)
  if (!jwk) throw new AttendanceError('Kunci HP tidak valid.')
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; tenant_id: string; user_id: string; user_name: string; created_by: string; expired: boolean; used: boolean }>(
      `SELECT id, tenant_id, user_id, user_name, created_by, expires_at < now() AS expired, used_at IS NOT NULL AS used
         FROM staff_phone_enrollments WHERE token_hash = $1 FOR UPDATE`,
      [sha256Hex(token)],
    )
    const e = rows[0]
    if (!e) throw new AttendanceError('Tautan pendaftaran tidak dikenal.', 404)
    if (e.used) throw new AttendanceError('Tautan pendaftaran sudah dipakai. Minta admin membuat yang baru.', 410)
    if (e.expired) throw new AttendanceError('Tautan pendaftaran sudah kedaluwarsa. Minta admin membuat yang baru.', 410)
    await client.query('UPDATE staff_phone_enrollments SET used_at = now() WHERE id = $1', [e.id])
    // Satu HP aktif per karyawan: HP lama otomatis tak bisa dipakai lagi.
    await client.query('UPDATE staff_phones SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL', [e.tenant_id, e.user_id])
    const phone = await client.query<{ id: string }>(
      `INSERT INTO staff_phones (tenant_id, user_id, user_name, public_key, label, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
      [e.tenant_id, e.user_id, e.user_name, JSON.stringify(jwk), label.trim().slice(0, 60) || 'HP', e.created_by],
    )
    return { phoneId: phone.rows[0].id, userName: e.user_name, businessName: await businessName(client, e.tenant_id) }
  })
}

export interface StaffPhoneRow {
  id: string
  userId: string
  userName: string
  label: string
  createdBy: string
  createdAt: number
  lastUsedAt: number | null
}

export async function listPhones(pool: Pool, tenantId: string): Promise<StaffPhoneRow[]> {
  const { rows } = await pool.query<{ id: string; user_id: string; user_name: string; label: string; created_by: string; created_at: Date; last_used_at: Date | null }>(
    `SELECT id, user_id, user_name, label, created_by, created_at, last_used_at FROM staff_phones
      WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY user_name`,
    [tenantId],
  )
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    label: r.label,
    createdBy: r.created_by,
    createdAt: r.created_at.getTime(),
    lastUsedAt: r.last_used_at?.getTime() ?? null,
  }))
}

export async function revokePhone(pool: Pool, tenantId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE staff_phones SET revoked_at = now() WHERE tenant_id = $1 AND id::text = $2 AND revoked_at IS NULL', [tenantId, id])
  return (rowCount ?? 0) > 0
}

// ---- Absen ----

interface PhoneRow {
  id: string
  tenant_id: string
  user_id: string
  user_name: string
  public_key: { kty: 'EC'; crv: 'P-256'; x: string; y: string }
  label: string
}

async function activePhone(client: Pool | PoolClient, phoneId: string): Promise<PhoneRow> {
  if (!/^[0-9a-f-]{36}$/i.test(phoneId)) throw new AttendanceError('HP belum terdaftar.', 401)
  const { rows } = await client.query<PhoneRow>('SELECT id, tenant_id, user_id, user_name, public_key, label FROM staff_phones WHERE id = $1 AND revoked_at IS NULL', [phoneId])
  if (!rows[0]) throw new AttendanceError('HP ini tidak terdaftar atau sudah dicabut admin. Minta admin mendaftarkan ulang.', 401)
  return rows[0]
}

/** Tanda tangan ECDSA P-256/SHA-256 dari WebCrypto (format r||s, 64 byte). */
function signatureValid(publicKey: PhoneRow['public_key'], message: string, signatureB64: string): boolean {
  let key: KeyObject
  try {
    key = createPublicKey({ key: publicKey, format: 'jwk' })
  } catch {
    return false
  }
  const sig = Buffer.from(signatureB64, 'base64url')
  if (sig.length !== 64) return false
  return verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, sig)
}

/** Pesan yang ditandatangani HP. HARUS identik dengan src/features/absen/absenCrypto.ts. */
export const challengeMessage = (phoneId: string, qr: string) => `kione-absen/challenge\n${phoneId}\n${qr}`
export const punchMessage = (challengeId: string, selfieSha256: string, location: string) => `kione-absen/punch\n${challengeId}\n${selfieSha256}\n${location}`
export const locationText = (loc: PunchLocation | null) => (loc ? `${loc.latitude.toFixed(6)},${loc.longitude.toFixed(6)},${Math.round(loc.accuracy)}` : '-')

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

export interface ChallengeResult {
  challengeId: string
  type: 'in' | 'out'
  userName: string
  businessName: string
  selfieRequired: boolean
  clockedInSince: number | null
  expiresAt: number
}

/** Langkah 1: HP menyerahkan QR yang baru dipindai → tantangan untuk selfie. */
export async function startPunch(pool: Pool, input: { phoneId: string; qr: string; signature: string }): Promise<ChallengeResult> {
  const phone = await activePhone(pool, input.phoneId)
  if (!signatureValid(phone.public_key, challengeMessage(phone.id, input.qr), input.signature)) {
    throw new AttendanceError('Tanda tangan HP tidak cocok. Daftarkan ulang HP ini.', 401)
  }
  const window = checkQr(await getQrSecret(pool, phone.tenant_id), input.qr)
  if (window == null) throw new AttendanceError('QR sudah kedaluwarsa. Pindai lagi QR yang sedang tampil di tablet kasir.', 409)
  const now = Date.now()
  const expiresAt = now + CHALLENGE_TTL_MS
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO staff_punch_challenges (tenant_id, phone_id, qr_window, expires_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0)) RETURNING id`,
    [phone.tenant_id, phone.id, window, expiresAt],
  )
  const since = await clockedInSince(pool, phone.tenant_id, phone.user_id, now)
  return {
    challengeId: rows[0].id,
    type: since != null ? 'out' : 'in',
    userName: phone.user_name,
    businessName: await businessName(pool, phone.tenant_id),
    selfieRequired: await selfieRequired(pool, phone.tenant_id),
    clockedInSince: since,
    expiresAt,
  }
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

/** Langkah 2: selfie (+ lokasi bila diizinkan) dengan tanda tangan HP → absen tercatat. */
export async function completePunch(input: {
  phoneId: string
  challengeId: string
  selfieBase64: string | null
  location: PunchLocation | null
  signature: string
  ip: string | null
  userAgent: string | null
}): Promise<PunchResult> {
  const selfie = input.selfieBase64 ? Buffer.from(input.selfieBase64, 'base64') : null
  if (selfie && (selfie.length > MAX_SELFIE_BYTES || selfie[0] !== 0xff || selfie[1] !== 0xd8)) throw new AttendanceError('Foto selfie tidak valid.')
  if (!/^[0-9a-f-]{36}$/i.test(input.challengeId)) throw new AttendanceError('Sesi absen tidak dikenal. Pindai QR lagi.', 404)

  return withTransaction(async (client) => {
    const phone = await activePhone(client, input.phoneId)
    const message = punchMessage(input.challengeId, selfie ? sha256Hex(selfie) : '-', locationText(input.location))
    if (!signatureValid(phone.public_key, message, input.signature)) throw new AttendanceError('Tanda tangan HP tidak cocok. Daftarkan ulang HP ini.', 401)

    const ch = await client.query<{ expired: boolean; used: boolean }>(
      'SELECT expires_at < now() AS expired, used_at IS NOT NULL AS used FROM staff_punch_challenges WHERE id = $1 AND phone_id = $2 FOR UPDATE',
      [input.challengeId, phone.id],
    )
    if (!ch.rows[0]) throw new AttendanceError('Sesi absen tidak dikenal. Pindai QR lagi.', 404)
    if (ch.rows[0].used) throw new AttendanceError('Sesi absen ini sudah dipakai. Pindai QR lagi.', 409)
    if (ch.rows[0].expired) throw new AttendanceError('Waktu selfie habis. Pindai QR lagi.', 409)
    if (!selfie && (await selfieRequired(client, phone.tenant_id))) throw new AttendanceError('Selfie wajib untuk absen.')
    await client.query('UPDATE staff_punch_challenges SET used_at = now() WHERE id = $1', [input.challengeId])

    // Kunci ujung rantai tenant ini → absen serentak tetap berurutan & arah masuk/pulang konsisten.
    await client.query('INSERT INTO staff_attendance_chain (tenant_id, seq, hash) VALUES ($1, 0, $2) ON CONFLICT (tenant_id) DO NOTHING', [phone.tenant_id, ''])
    const head = (await client.query<{ seq: string; hash: string }>('SELECT seq, hash FROM staff_attendance_chain WHERE tenant_id = $1 FOR UPDATE', [phone.tenant_id])).rows[0]

    const at = Date.now()
    const since = await clockedInSince(client, phone.tenant_id, phone.user_id, at)
    const type: 'in' | 'out' = since != null ? 'out' : 'in'
    const minutes = since != null ? Math.round((at - since) / 60000) : 0
    const via = `lewat HP (${phone.label}${selfie ? ', selfie' : ', tanpa selfie'}${input.location ? '' : ', tanpa lokasi'})`
    const id = randomUUID()
    const seq = Number(head.seq) + 1
    const entryBase = {
      id,
      userId: phone.user_id,
      userName: phone.user_name,
      action: type === 'in' ? 'attendance.in' : 'attendance.out',
      entityType: 'attendance',
      entityId: phone.user_id,
      details: type === 'in' ? `${phone.user_name} absen masuk ${via}.` : `${phone.user_name} absen pulang setelah ${formatMinutes(minutes)} ${via}.`,
      createdAt: at,
      deviceId: SERVER_CHAIN_DEVICE_ID,
      deviceSeq: seq,
      prevHash: head.hash || null,
    }
    const entry = { ...entryBase, hash: auditEntryHash(entryBase) }

    await client.query(
      `INSERT INTO staff_attendance_punches (id, tenant_id, user_id, user_name, phone_id, type, created_at, selfie, latitude, longitude, accuracy_m, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10, $11, $12, $13)`,
      [id, phone.tenant_id, phone.user_id, phone.user_name, phone.id, type, at, selfie, input.location?.latitude ?? null, input.location?.longitude ?? null, input.location?.accuracy ?? null, input.ip, input.userAgent?.slice(0, 300) ?? null],
    )
    await client.query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
       VALUES ($1, 'auditLogs', $2, $3::jsonb, $4, nextval('sync_server_seq'), now())`,
      [phone.tenant_id, id, JSON.stringify(entry), at],
    )
    await client.query('UPDATE staff_attendance_chain SET seq = $2, hash = $3 WHERE tenant_id = $1', [phone.tenant_id, seq, entry.hash])
    await client.query('UPDATE staff_phones SET last_used_at = now() WHERE id = $1', [phone.id])
    return { type, at, userName: phone.user_name, minutes }
  })
}

// ---- Konsol Pemilik ----

export interface AttendanceLogRow {
  id: string
  userName: string
  type: 'in' | 'out'
  /** 'phone' = HP terdaftar; 'manual' = dicatat admin di tablet (pengecualian); 'pin' = absen PIN lama. */
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
    pool.query<{ id: string; type: 'in' | 'out'; label: string; has_selfie: boolean; latitude: number | null; longitude: number | null; accuracy_m: number | null }>(
      `SELECT p.id, p.type, ph.label, p.selfie IS NOT NULL AS has_selfie, p.latitude, p.longitude, p.accuracy_m
         FROM staff_attendance_punches p JOIN staff_phones ph ON ph.id = p.phone_id
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
