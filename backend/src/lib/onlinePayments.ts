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
  params: {
    orderId: string
    billId: string
    amount: number
    method: 'qris' | 'transfer' | 'card'
    reference: string
    tenantId?: string
  },
): Promise<{ inserted: boolean }> {
  const tenantId = params.tenantId ?? (await findOrderTenant(pool, params.orderId))
  const now = Date.now()
  const payload = {
    id: params.reference,
    orderId: params.orderId,
    billId: params.billId,
    amount: params.amount,
    method: params.method,
    reference: params.reference,
    createdAt: now,
  }
  const res = await pool.query(
    `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
       VALUES ($1, 'onlinePayments', $2, $3::jsonb, $4, nextval('sync_server_seq'), now())
     ON CONFLICT (tenant_id, entity, entity_id) DO NOTHING`,
    [tenantId, params.reference, JSON.stringify(payload), now],
  )
  return { inserted: (res.rowCount ?? 0) > 0 }
}

async function findOrderTenant(pool: Pool, orderId: string): Promise<string> {
  const { rows } = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM sync_entity_state WHERE entity = 'orders' AND entity_id = $1 LIMIT 2",
    [orderId],
  )
  if (rows.length !== 1) throw new Error('Tenant pesanan pembayaran tidak dapat ditentukan')
  return rows[0].tenant_id
}
