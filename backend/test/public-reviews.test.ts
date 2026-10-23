import { describe, expect, it } from 'vitest'
import { auditEntryHash, ORDER_ID_RE } from '../src/lib/publicReviews.js'

describe('publicReviews', () => {
  it('hash entri Log Aktivitas identik dengan aplikasi (src/lib/auditLogIntegrity.test.ts)', () => {
    const hash = auditEntryHash({
      id: 'a1', userId: 'server-ulasan', userName: 'Tamu (QR struk)', action: 'feedback.rating', entityType: 'feedback', entityId: 'o1',
      details: 'Penilaian tamu ★5/5 untuk TRX-00001. Komentar: Enak', createdAt: 1761200000000, deviceId: 'server-ulasan', deviceSeq: 1, prevHash: null,
    })
    expect(hash).toBe('cdb981ef6141f5872e14b729c1db534eccca381a5a24efbf68815b873c287dd8')
  })

  it('kode struk = UUID order', () => {
    expect(ORDER_ID_RE.test('3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b')).toBe(true)
    expect(ORDER_ID_RE.test('TRX-00001')).toBe(false)
    expect(ORDER_ID_RE.test("x' OR 1=1 --")).toBe(false)
  })
})
