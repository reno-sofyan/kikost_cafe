import { describe, expect, it } from 'vitest'
import { EMPTY_PROOF, isProofComplete } from './paymentProofDraft'

describe('isProofComplete', () => {
  it('kosong → belum lengkap; ada foto → lengkap', () => {
    expect(isProofComplete(EMPTY_PROOF)).toBe(false)
    expect(isProofComplete({ photos: ['data:x'] })).toBe(true)
  })
})
