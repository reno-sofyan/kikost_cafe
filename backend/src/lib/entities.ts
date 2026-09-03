import { z } from 'zod'

/**
 * Entitas yang boleh disinkronkan. HARUS identik dengan `SyncEntity` di
 * frontend (src/types/domain.ts). Perubahan di satu sisi wajib diikuti sisi lain.
 */
export const SYNC_ENTITIES = [
  'orders',
  'orderItems',
  'kitchenTickets',
  'bills',
  'payments',
  'shifts',
  'cashMovements',
  'expenses',
  'returns',
  'stockMovements',
  'purchases',
  'stockOpnames',
  'products',
  'ingredients',
  'recipes',
  'categories',
  'customers',
  'auditLogs',
] as const

export type SyncEntity = (typeof SYNC_ENTITIES)[number]

const entitySet = new Set<string>(SYNC_ENTITIES)

export function isSyncEntity(value: unknown): value is SyncEntity {
  return typeof value === 'string' && entitySet.has(value)
}

/** Status pesanan yang dianggap final; tidak boleh dikembalikan ke `open` oleh sinkronisasi. */
const FINAL_ORDER_STATUSES = new Set(['paid', 'void', 'completed'])

/**
 * Validasi minimal payload: harus objek dengan `id` string yang cocok dengan entityId,
 * dan memiliki penanda waktu untuk LWW. Kita sengaja tidak memvalidasi setiap field
 * bisnis di server — klien adalah sumber kebenaran bisnis — tetapi menolak data yang
 * jelas rusak sehingga tidak mencemari state kanonik.
 */
const basePayloadSchema = z
  .object({
    id: z.string().min(1),
    updatedAt: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative().optional(),
  })
  .passthrough()

export interface NormalizedPayload {
  id: string
  entityUpdatedAt: number
  raw: Record<string, unknown>
}

export function normalizePayload(entityId: string, payload: unknown): NormalizedPayload | { error: string } {
  const parsed = basePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return { error: 'Payload tidak valid: ' + parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const data = parsed.data
  if (data.id !== entityId) {
    return { error: `payload.id (${data.id}) tidak cocok dengan entityId (${entityId})` }
  }
  const entityUpdatedAt = data.updatedAt ?? data.createdAt ?? 0
  return { id: data.id, entityUpdatedAt, raw: data as Record<string, unknown> }
}

/**
 * Menentukan apakah payload masuk (`incoming`) boleh menggantikan state saat ini (`current`).
 * Aturan:
 *  - Jika belum ada state → terima.
 *  - Last-write-wins berdasarkan entity_updated_at (epoch ms).
 *  - Proteksi khusus `orders`: begitu pesanan final (paid/void/completed) di server,
 *    ia tidak boleh kembali ke `open`, dan tidak boleh berpindah ke pesanan final lain
 *    yang berbeda (mis. paid -> void) kecuali penanda waktunya lebih baru (retur/void sah).
 */
export function shouldApply(params: {
  entity: SyncEntity
  currentPayload: Record<string, unknown> | null
  currentUpdatedAt: number | null
  incomingPayload: Record<string, unknown>
  incomingUpdatedAt: number
}): { apply: boolean; reason?: string } {
  const { entity, currentPayload, currentUpdatedAt, incomingPayload, incomingUpdatedAt } = params

  if (!currentPayload || currentUpdatedAt == null) return { apply: true }

  // Audit log: append-only. Sekali sebuah entri tercatat di server, tidak boleh diubah.
  if (entity === 'auditLogs') {
    return { apply: false, reason: 'Audit log bersifat append-only' }
  }

  // Payment: immutable setelah ada. Nominal & metode tak boleh berubah lewat sync.
  if (entity === 'payments') {
    return { apply: false, reason: 'Pembayaran bersifat immutable setelah tercatat' }
  }

  if (entity === 'orders') {
    const currentStatus = String(currentPayload.status ?? '')
    const incomingStatus = String(incomingPayload.status ?? '')
    if (FINAL_ORDER_STATUSES.has(currentStatus)) {
      if (incomingStatus === 'open') {
        return { apply: false, reason: 'Pesanan sudah final di server; tidak boleh dikembalikan ke open' }
      }
      if (incomingUpdatedAt < currentUpdatedAt) {
        return { apply: false, reason: 'Pesanan final; payload masuk lebih lama dari state server' }
      }
      return { apply: true }
    }
  }

  if (incomingUpdatedAt < currentUpdatedAt) {
    return { apply: false, reason: 'Payload masuk lebih lama dari state server (last-write-wins)' }
  }
  return { apply: true }
}
