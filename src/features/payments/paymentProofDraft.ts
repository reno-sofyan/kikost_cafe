export interface PaymentProofDraft {
  photos: string[]
}

export const EMPTY_PROOF: PaymentProofDraft = { photos: [] }

/** Lengkap = ada foto. Untuk metode wajib (QRIS kantin) tak ada jalan pintas tanpa foto. */
export function isProofComplete(draft: PaymentProofDraft): boolean {
  return draft.photos.length > 0
}
