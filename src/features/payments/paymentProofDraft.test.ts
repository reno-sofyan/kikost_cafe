import { describe, expect, it } from 'vitest'
import { EMPTY_PROOF, isProofComplete } from './paymentProofDraft'

describe('isProofComplete', () => {
  it('kosong → belum lengkap; foto atau alasan terisi → lengkap', () => {
    expect(isProofComplete(EMPTY_PROOF)).toBe(false)
    expect(isProofComplete({ photos: ['data:x'], noPhotoReason: null })).toBe(true)
    expect(isProofComplete({ photos: [], noPhotoReason: '' })).toBe(false)
    expect(isProofComplete({ photos: [], noPhotoReason: '   ' })).toBe(false)
    expect(isProofComplete({ photos: [], noPhotoReason: 'kamera rusak' })).toBe(true)
  })
})
