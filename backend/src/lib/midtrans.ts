import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Adaptor tipis ke Midtrans Core API (QRIS) untuk pembayaran online dari
 * halaman pesan-mandiri (/order/:token). Server-side murni: server yang
 * menentukan nominal (dari `orders` di `sync_entity_state`), bukan klien.
 *
 * Alur:
 *   1. `createQrisCharge` — POST /v2/charge (payment_type: qris) → dapat
 *      `qr_string` untuk dirender jadi gambar QR di halaman pelanggan.
 *   2. Midtrans mengirim notifikasi server-to-server ke
 *      /api/payments/midtrans/notification saat status transaksi berubah.
 *      `verifyNotificationSignature` memverifikasi keasliannya sebelum dipakai.
 */

export function midtransBaseUrl(isProduction: boolean): string {
  return isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'
}

/** ID order kita (UUID, tanpa underscore) tak pernah dipakai ulang ke Midtrans —
 * tiap percobaan bayar butuh order_id baru di sisi Midtrans. Nonce ditambahkan
 * supaya bisa dicoba ulang (mis. QR kedaluwarsa) tanpa bentrok "order_id already exists". */
export function encodeMidtransOrderId(orderId: string): string {
  return `${orderId}_${randomBytes(4).toString('hex')}`
}

/** Kebalikan `encodeMidtransOrderId`. UUID order kita tak mengandung underscore,
 * jadi memotong di underscore terakhir aman. */
export function decodeMidtransOrderId(midtransOrderId: string): string {
  const idx = midtransOrderId.lastIndexOf('_')
  return idx === -1 ? midtransOrderId : midtransOrderId.slice(0, idx)
}

export class MidtransError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'MidtransError'
  }
}

export interface QrisChargeResult {
  transactionId: string
  midtransOrderId: string
  qrString: string
  grossAmount: number
  transactionStatus: string
  expiryTime: string | null
}

/** POST /v2/charge (payment_type: qris) — Core API Midtrans. */
export async function createQrisCharge(params: {
  serverKey: string
  isProduction: boolean
  midtransOrderId: string
  grossAmount: number
}): Promise<QrisChargeResult> {
  const auth = Buffer.from(`${params.serverKey}:`).toString('base64')
  const res = await fetch(`${midtransBaseUrl(params.isProduction)}/v2/charge`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      payment_type: 'qris',
      transaction_details: {
        order_id: params.midtransOrderId,
        gross_amount: params.grossAmount,
      },
    }),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const msg = typeof data.status_message === 'string' ? data.status_message : `Midtrans charge gagal (${res.status})`
    throw new MidtransError(msg, res.status)
  }
  const actions = Array.isArray(data.actions) ? (data.actions as Record<string, unknown>[]) : []
  const qrAction = actions.find((a) => a.name === 'generate-qr-code')
  const qrString = typeof data.qr_string === 'string' ? data.qr_string : typeof qrAction?.url === 'string' ? (qrAction.url as string) : ''
  if (!qrString) throw new MidtransError('Respons Midtrans tidak berisi QR.', 502)

  return {
    transactionId: String(data.transaction_id ?? ''),
    midtransOrderId: params.midtransOrderId,
    qrString,
    grossAmount: params.grossAmount,
    transactionStatus: String(data.transaction_status ?? 'pending'),
    expiryTime: typeof data.expiry_time === 'string' ? data.expiry_time : null,
  }
}

/** Verifikasi tanda tangan notifikasi Midtrans: SHA512(order_id+status_code+gross_amount+ServerKey). */
export function verifyMidtransSignature(params: {
  orderId: string
  statusCode: string
  grossAmount: string
  signatureKey: string
  serverKey: string
}): boolean {
  const expected = createHash('sha512')
    .update(`${params.orderId}${params.statusCode}${params.grossAmount}${params.serverKey}`)
    .digest('hex')
  const provided = params.signatureKey
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/** Notifikasi dianggap "lunas" hanya untuk settlement, atau capture yang lolos fraud check. */
export function isMidtransPaidStatus(transactionStatus: string, fraudStatus: string | undefined): boolean {
  if (transactionStatus === 'settlement') return true
  if (transactionStatus === 'capture') return fraudStatus === 'accept'
  return false
}
