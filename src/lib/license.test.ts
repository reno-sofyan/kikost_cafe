import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PUBLIC_KEY_JWK,
  InvalidLicenseSignatureError,
  MalformedLicenseError,
  canonicalLicenseBytes,
  clearStoredLicense,
  evaluateLicenseStatus,
  getCurrentLicenseState,
  loadStoredLicense,
  parseSignedLicense,
  saveStoredLicense,
  verifySignedLicense,
  type LicensePayload,
  type SignedLicense,
} from './license'

/**
 * Ditandatangani sungguhan lewat `scripts/license/sign-license.mjs
 *   --key scripts/license/dev-keypair.json --license-id L-TEST-0001
 *   --business "Kopi Demo" --plan pro --expires 2027-01-01 --max-devices 2`
 * — kunci publiknya SAMA PERSIS dengan DEFAULT_PUBLIC_KEY_JWK di license.ts,
 * jadi test ini membuktikan tooling CLI vendor & modul verifikasi klien
 * benar-benar saling cocok (bukan cuma masing-masing lulus sendiri-sendiri).
 */
const VALID_LICENSE: SignedLicense = {
  payload: {
    licenseId: 'L-TEST-0001',
    businessName: 'Kopi Demo',
    plan: 'pro',
    issuedAt: 1790669375609,
    expiresAt: 1798761600000, // 2027-01-01T00:00:00.000Z
    maxDevices: 2,
  },
  signature:
    'vM4kztvqvtXJjwBbYX7f0EC3ynPV0tFzNXXuhh/A8+SjRJGFeeTs/UTChLfgc3VF8iJo8qx1NGjf0bQ7ajob8A==',
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('verifySignedLicense', () => {
  it('menerima lisensi yang ditandatangani tool CLI vendor dengan kunci privat yang cocok', async () => {
    const payload = await verifySignedLicense(VALID_LICENSE)
    expect(payload).toEqual(VALID_LICENSE.payload)
  })

  it('menolak bila SATU field saja diubah setelah ditandatangani (mis. memperpanjang expiresAt sendiri)', async () => {
    const tampered: SignedLicense = {
      ...VALID_LICENSE,
      payload: { ...VALID_LICENSE.payload, expiresAt: VALID_LICENSE.payload.expiresAt! + 1000 * 60 * 60 * 24 * 365 },
    }
    await expect(verifySignedLicense(tampered)).rejects.toThrow(InvalidLicenseSignatureError)
  })

  it('menolak bila plan diubah (mis. trial dinaikkan jadi pro tanpa tanda tangan baru)', async () => {
    const tampered: SignedLicense = { ...VALID_LICENSE, payload: { ...VALID_LICENSE.payload, plan: 'standard' } }
    await expect(verifySignedLicense(tampered)).rejects.toThrow(InvalidLicenseSignatureError)
  })

  it('menolak tanda tangan acak/rusak', async () => {
    const tampered: SignedLicense = { ...VALID_LICENSE, signature: btoa('bukan-tanda-tangan-sah') }
    await expect(verifySignedLicense(tampered)).rejects.toThrow(InvalidLicenseSignatureError)
  })

  it('menolak lisensi yang ditandatangani kunci privat LAIN (bukan pasangan kunci publik aplikasi)', async () => {
    const { subtle } = crypto
    const otherKeyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const signatureBytes = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      otherKeyPair.privateKey,
      canonicalLicenseBytes(VALID_LICENSE.payload) as BufferSource,
    )
    const forged: SignedLicense = {
      payload: VALID_LICENSE.payload,
      signature: btoa(String.fromCharCode(...new Uint8Array(signatureBytes))),
    }
    await expect(verifySignedLicense(forged, DEFAULT_PUBLIC_KEY_JWK)).rejects.toThrow(InvalidLicenseSignatureError)
  })
})

describe('parseSignedLicense', () => {
  it('menolak JSON yang tidak valid', () => {
    expect(() => parseSignedLicense('bukan json{{')).toThrow(MalformedLicenseError)
  })

  it('menolak struktur yang tidak lengkap', () => {
    expect(() => parseSignedLicense(JSON.stringify({ payload: {} }))).toThrow(MalformedLicenseError)
  })

  it('menerima struktur yang sah', () => {
    const parsed = parseSignedLicense(JSON.stringify(VALID_LICENSE))
    expect(parsed).toEqual(VALID_LICENSE)
  })
})

describe('evaluateLicenseStatus', () => {
  const payload: LicensePayload = { ...VALID_LICENSE.payload }

  it('unlicensed bila belum ada payload', () => {
    expect(evaluateLicenseStatus(null).status).toBe('unlicensed')
  })

  it('active sebelum expiresAt', () => {
    expect(evaluateLicenseStatus(payload, payload.expiresAt! - 1).status).toBe('active')
  })

  it('expired setelah expiresAt', () => {
    expect(evaluateLicenseStatus(payload, payload.expiresAt! + 1).status).toBe('expired')
  })

  it('lisensi perpetual (expiresAt null) selalu active berapa pun "now"-nya', () => {
    const perpetual: LicensePayload = { ...payload, expiresAt: null }
    expect(evaluateLicenseStatus(perpetual, Number.MAX_SAFE_INTEGER).status).toBe('active')
  })
})

describe('penyimpanan lisensi di perangkat', () => {
  it('loadStoredLicense null bila belum pernah disimpan', () => {
    expect(loadStoredLicense()).toBeNull()
  })

  it('save lalu load mengembalikan lisensi yang sama', () => {
    saveStoredLicense(VALID_LICENSE)
    expect(loadStoredLicense()).toEqual(VALID_LICENSE)
  })

  it('clear menghapus lisensi tersimpan', () => {
    saveStoredLicense(VALID_LICENSE)
    clearStoredLicense()
    expect(loadStoredLicense()).toBeNull()
  })
})

describe('getCurrentLicenseState (titik masuk gabungan verifikasi + evaluasi)', () => {
  it('unlicensed bila tidak ada lisensi tersimpan', async () => {
    expect(await getCurrentLicenseState()).toEqual({ status: 'unlicensed', payload: null })
  })

  it('invalid (gagal aman) bila lisensi tersimpan sudah dirusak, bukan exception yang lolos', async () => {
    saveStoredLicense({ ...VALID_LICENSE, payload: { ...VALID_LICENSE.payload, businessName: 'Usaha Lain' } })
    await expect(getCurrentLicenseState()).resolves.toEqual({ status: 'invalid', payload: null })
  })

  it('active bila lisensi sah & belum kedaluwarsa menurut jam yang dipercaya', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(VALID_LICENSE.payload.expiresAt! - 1000)
    saveStoredLicense(VALID_LICENSE)

    const state = await getCurrentLicenseState()
    expect(state.status).toBe('active')
    expect(state.payload?.licenseId).toBe('L-TEST-0001')
  })

  it('expired bila melewati expiresAt menurut jam yang dipercaya', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(VALID_LICENSE.payload.expiresAt! + 1000)
    saveStoredLicense(VALID_LICENSE)

    expect((await getCurrentLicenseState()).status).toBe('expired')
  })
})
