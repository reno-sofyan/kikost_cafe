export interface PaymentProofDraft {
  photos: string[]
  /** `null` = mode foto; string (boleh kosong saat diketik) = "Tidak bisa ambil foto". */
  noPhotoReason: string | null
}

export const EMPTY_PROOF: PaymentProofDraft = { photos: [], noPhotoReason: null }

/** Lengkap = ada foto, atau alasan tanpa foto sudah diisi. */
export function isProofComplete(draft: PaymentProofDraft): boolean {
  return draft.photos.length > 0 || !!draft.noPhotoReason?.trim()
}
