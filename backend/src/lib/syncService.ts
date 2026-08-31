import type { PoolClient } from 'pg'
import { getPool, withTransaction } from '../db/pool.js'
import { loadConfig } from '../config.js'
import {
  isSyncEntity,
  normalizePayload,
  shouldApply,
  SYNC_ENTITIES,
  type SyncEntity,
} from './entities.js'
import { touchDeviceLastSeen } from './deviceAuth.js'

export interface PushItem {
  entity: string
  entityId: string
  idempotencyKey: string
  payload?: unknown
}

export interface PushResultItem {
  idempotencyKey: string
  status: 'accepted' | 'duplicate' | 'rejected'
  error?: string
}

export interface PushResponse {
  results: PushResultItem[]
  serverTime: number
}

export interface PullResponse {
  entities: Partial<Record<SyncEntity, unknown[]>>
  serverTime: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function currentServerSeq(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ seq: string }>("SELECT last_value AS seq FROM sync_server_seq")
  return Number(rows[0]?.seq ?? 0)
}

interface ExistingState {
  payload: Record<string, unknown>
  entity_updated_at: string
}

export async function processPush(params: {
  deviceId: string | null
  items: PushItem[]
}): Promise<PushResponse> {
  const config = loadConfig()
  const { deviceId, items } = params

  if (items.length === 0) {
    const c = await getPool().connect()
    try {
      return { results: [], serverTime: await currentServerSeq(c) }
    } finally {
      c.release()
    }
  }
  if (items.length > config.SYNC_MAX_BATCH) {
    throw Object.assign(new Error(`Batch melebihi batas ${config.SYNC_MAX_BATCH} item`), { statusCode: 413 })
  }

  return withTransaction(async (client) => {
    await touchDeviceLastSeen(client, deviceId)
    const results: PushResultItem[] = []
    let accepted = 0
    let duplicate = 0
    let rejected = 0

    for (const item of items) {
      const res = await processOneItem(client, deviceId, item)
      results.push(res)
      if (res.status === 'accepted') accepted++
      else if (res.status === 'duplicate') duplicate++
      else rejected++
    }

    await client.query(
      `INSERT INTO sync_push_log (device_id, item_count, accepted, duplicate, rejected)
       VALUES ($1, $2, $3, $4, $5)`,
      [deviceId, items.length, accepted, duplicate, rejected],
    )

    const serverTime = await currentServerSeq(client)
    return { results, serverTime }
  })
}

async function processOneItem(
  client: PoolClient,
  deviceId: string | null,
  item: PushItem,
): Promise<PushResultItem> {
  const { idempotencyKey } = item

  if (!UUID_RE.test(idempotencyKey ?? '')) {
    return { idempotencyKey, status: 'rejected', error: 'idempotencyKey harus UUID' }
  }

  // Idempotency: kunci yang sudah pernah diproses mengembalikan hasil sebelumnya.
  const prior = await client.query<{ result: string }>(
    'SELECT result FROM sync_idempotency WHERE idempotency_key = $1',
    [idempotencyKey],
  )
  if (prior.rows.length > 0) {
    const priorResult = prior.rows[0].result
    return {
      idempotencyKey,
      status: priorResult === 'rejected' ? 'rejected' : 'duplicate',
      error: priorResult === 'rejected' ? 'Sebelumnya ditolak' : undefined,
    }
  }

  if (!isSyncEntity(item.entity)) {
    await recordIdempotency(client, item, deviceId, 'rejected', 'Entitas tidak dikenal', null)
    return { idempotencyKey, status: 'rejected', error: `Entitas tidak dikenal: ${item.entity}` }
  }

  const normalized = normalizePayload(item.entityId, item.payload)
  if ('error' in normalized) {
    await recordIdempotency(client, item, deviceId, 'rejected', normalized.error, null)
    return { idempotencyKey, status: 'rejected', error: normalized.error }
  }

  // Kunci baris state (bila ada) untuk mencegah balapan antar batch paralel.
  const existing = await client.query<ExistingState>(
    'SELECT payload, entity_updated_at FROM sync_entity_state WHERE entity = $1 AND entity_id = $2 FOR UPDATE',
    [item.entity, item.entityId],
  )
  const currentPayload = existing.rows[0]?.payload ?? null
  const currentUpdatedAt = existing.rows[0] ? Number(existing.rows[0].entity_updated_at) : null

  const decision = shouldApply({
    entity: item.entity,
    currentPayload,
    currentUpdatedAt,
    incomingPayload: normalized.raw,
    incomingUpdatedAt: normalized.entityUpdatedAt,
  })

  if (!decision.apply) {
    // Konflik yang ditangani eksplisit: kita ANGGAP diterima (klien tidak perlu retry),
    // tetapi state server dipertahankan. Dicatat sebagai duplicate + detail alasan.
    await recordIdempotency(client, item, deviceId, 'duplicate', decision.reason ?? 'Konflik LWW', null)
    return { idempotencyKey, status: 'duplicate', error: decision.reason }
  }

  const upserted = await client.query<{ server_seq: string }>(
    `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, origin_device_id, server_seq, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, nextval('sync_server_seq'), now())
     ON CONFLICT (entity, entity_id) DO UPDATE
       SET payload = EXCLUDED.payload,
           entity_updated_at = EXCLUDED.entity_updated_at,
           origin_device_id = EXCLUDED.origin_device_id,
           server_seq = nextval('sync_server_seq'),
           updated_at = now()
     RETURNING server_seq`,
    [item.entity, item.entityId, JSON.stringify(normalized.raw), normalized.entityUpdatedAt, deviceId],
  )
  const serverSeq = Number(upserted.rows[0].server_seq)

  await recordIdempotency(client, item, deviceId, 'accepted', null, serverSeq)
  return { idempotencyKey, status: 'accepted' }
}

async function recordIdempotency(
  client: PoolClient,
  item: PushItem,
  deviceId: string | null,
  result: 'accepted' | 'duplicate' | 'rejected',
  detail: string | null,
  serverSeq: number | null,
): Promise<void> {
  await client.query(
    `INSERT INTO sync_idempotency (idempotency_key, entity, entity_id, result, detail, device_id, server_seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [item.idempotencyKey, item.entity, item.entityId, result, detail, deviceId, serverSeq],
  )
}

export async function processPull(sinceRaw: number): Promise<PullResponse> {
  const config = loadConfig()
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0
  const client = await getPool().connect()
  try {
    const entities: Partial<Record<SyncEntity, unknown[]>> = {}
    let maxSeq = since

    for (const entity of SYNC_ENTITIES) {
      const { rows } = await client.query<{ payload: unknown; server_seq: string }>(
        `SELECT payload, server_seq
           FROM sync_entity_state
          WHERE entity = $1 AND server_seq > $2 AND deleted = FALSE
          ORDER BY server_seq
          LIMIT $3`,
        [entity, since, config.SYNC_PULL_LIMIT],
      )
      if (rows.length > 0) {
        entities[entity] = rows.map((r) => r.payload)
        const localMax = Number(rows[rows.length - 1].server_seq)
        if (localMax > maxSeq) maxSeq = localMax
      }
    }

    return { entities, serverTime: maxSeq }
  } finally {
    client.release()
  }
}
