/** Nomor HP Indonesia → format internasional tanpa "+", mis. "0812-3456" → "628123456". Kosong bila tak valid. */
export function waPhone(phone: string | null | undefined): string {
  let digits = (phone ?? '').replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  else if (digits.startsWith('8')) digits = `62${digits}`
  return digits.length >= 10 && digits.length <= 15 ? digits : ''
}

/** Tautan yang membuka WhatsApp ke nomor itu dengan pesan siap kirim (null bila nomornya tak valid). */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const to = waPhone(phone)
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null
}

export type GreetingKind = 'birthday' | 'winback' | 'general'

/** Draf pesan sapaan; kasir masih bisa mengubahnya sebelum dikirim. */
export function greetingMessage(params: { kind: GreetingKind; customerName: string; businessName: string; voucherCode?: string | null; voucherLabel?: string | null }): string {
  const name = params.customerName.trim().split(/\s+/)[0] || 'Kak'
  const biz = params.businessName.trim() || 'kami'
  const voucher = params.voucherCode
    ? ` Pakai kode *${params.voucherCode}*${params.voucherLabel ? ` (${params.voucherLabel})` : ''} saat berkunjung, ya.`
    : ''
  if (params.kind === 'birthday') return `Halo ${name}, selamat ulang tahun dari ${biz}! 🎉 Semoga sehat dan bahagia selalu.${voucher}`
  if (params.kind === 'winback') return `Halo ${name}, sudah lama tidak mampir ke ${biz}. Kami kangen!${voucher || ' Ditunggu kedatangannya, ya.'}`
  return `Halo ${name}, terima kasih sudah menjadi pelanggan ${biz}.${voucher}`
}
