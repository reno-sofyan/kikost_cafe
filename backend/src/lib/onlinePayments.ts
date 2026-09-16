import type { Pool } from 'pg'

/**
 * Menulis satu notifikasi pembayaran online ke `sync_entity_state` (entitas
 * `onlinePayments`, append-only, idempoten by `reference`). Dipakai bersama
 * oleh webhook generik (`paymentWebhook.ts`) dan adaptor gateway spesifik
 * (mis. `midtransPay.ts`) supaya efeknya konsisten: TABLET yang menjalankan
 * `payBill` lokal saat menariknya lewat sinkronisasi biasa — kebenaran bisnis
 * tetap di klien, jalur kasir offline tak berubah.
 */
export async function recordOnlinePayment(
  pool: Pool,
  params: { orderId: string; billId: string; amount: number; method: 'qris' | 'transfer' | 'card'; reference: string },
): Promise<{ inserted: boolean }> {
  const now = Date.now()
  const payload = { id: params.reference, ...params, createdAt: now }
  const res = await pool.query(
    `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
       VALUES ('onlinePayments', $1, $2::jsonb, $3, nextval('sync_server_seq'), now())
     ON CONFLICT (entity, entity_id) DO NOTHING`,
    [params.reference, JSON.stringify(payload), now],
  )
  return { inserted: (res.rowCount ?? 0) > 0 }
}
