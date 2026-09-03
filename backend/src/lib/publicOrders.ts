import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { withTransaction } from '../db/pool.js'

/**
 * Jalur publik pemesanan mandiri via QR. Katalog & total DIHITUNG DI SERVER dari
 * `sync_entity_state` (di-push tablet); order QR yang masuk ditulis kembali ke
 * `sync_entity_state` supaya tablet menariknya lewat sinkronisasi biasa.
 * Perangkat pelanggan tidak pernah dipercaya untuk harga/pajak/diskon.
 */

interface CatalogSettings {
  cafeName: string
  address: string
  phone: string
  taxPercent: number
  serviceChargePercent: number
  roundingIncrement: number
}

interface CatalogProduct {
  id: string
  categoryId: string
  name: string
  price: number
  photoDataUrl: string | null
  isAvailable: boolean
  modifierGroupIds: string[]
}

interface CatalogCategory {
  id: string
  name: string
  sortOrder: number
  active: boolean
}

interface CatalogModifierGroup {
  id: string
  name: string
  required: boolean
  multiSelect: boolean
  sortOrder: number
}

interface CatalogModifierOption {
  id: string
  groupId: string
  name: string
  priceDelta: number
  sortOrder: number
}

export interface Catalog {
  settings: CatalogSettings
  products: CatalogProduct[]
  categories: CatalogCategory[]
  modifierGroups: CatalogModifierGroup[]
  modifierOptions: CatalogModifierOption[]
}

export interface ResolvedToken {
  tableId: string
  tableName: string
}

export class PublicOrderError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'PublicOrderError'
  }
}

const DEFAULT_SETTINGS: CatalogSettings = {
  cafeName: 'Kikost Cafe',
  address: '',
  phone: '',
  taxPercent: 0,
  serviceChargePercent: 0,
  roundingIncrement: 100,
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

async function readEntity<T = Record<string, unknown>>(client: PoolClient, entity: string): Promise<T[]> {
  const { rows } = await client.query<{ payload: T }>(
    'SELECT payload FROM sync_entity_state WHERE entity = $1 AND deleted = FALSE',
    [entity],
  )
  return rows.map((r) => r.payload)
}

export async function loadCatalog(client: PoolClient): Promise<Catalog> {
  // Berurutan: satu koneksi pg tidak boleh menjalankan query paralel.
  const settingsRows = await readEntity<Record<string, unknown>>(client, 'settings')
  const products = await readEntity<Record<string, unknown>>(client, 'products')
  const categories = await readEntity<Record<string, unknown>>(client, 'categories')
  const modifierGroups = await readEntity<Record<string, unknown>>(client, 'modifierGroups')
  const modifierOptions = await readEntity<Record<string, unknown>>(client, 'modifierOptions')

  const s = settingsRows[0]
  const settings: CatalogSettings = s
    ? {
        cafeName: typeof s.cafeName === 'string' ? s.cafeName : DEFAULT_SETTINGS.cafeName,
        address: typeof s.address === 'string' ? s.address : '',
        phone: typeof s.phone === 'string' ? s.phone : '',
        taxPercent: num(s.taxPercent),
        serviceChargePercent: num(s.serviceChargePercent),
        roundingIncrement: num(s.roundingIncrement, 100) || 100,
      }
    : { ...DEFAULT_SETTINGS }

  return {
    settings,
    products: products.map((p) => ({
      id: String(p.id),
      categoryId: String(p.categoryId ?? ''),
      name: String(p.name ?? ''),
      price: num(p.price),
      photoDataUrl: typeof p.photoDataUrl === 'string' ? p.photoDataUrl : null,
      isAvailable: p.isAvailable !== false,
      modifierGroupIds: Array.isArray(p.modifierGroupIds) ? p.modifierGroupIds.map(String) : [],
    })),
    categories: categories.map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      sortOrder: num(c.sortOrder),
      active: c.active !== false,
    })),
    modifierGroups: modifierGroups.map((g) => ({
      id: String(g.id),
      name: String(g.name ?? ''),
      required: g.required === true,
      multiSelect: g.multiSelect === true,
      sortOrder: num(g.sortOrder),
    })),
    modifierOptions: modifierOptions.map((o) => ({
      id: String(o.id),
      groupId: String(o.groupId ?? ''),
      name: String(o.name ?? ''),
      priceDelta: num(o.priceDelta),
      sortOrder: num(o.sortOrder),
    })),
  }
}

/** Cari meja berdasarkan token QR di payload cafeTables. Token nonaktif → 410. */
export async function resolveToken(client: PoolClient, token: string): Promise<ResolvedToken> {
  const { rows } = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM sync_entity_state
      WHERE entity = 'cafeTables' AND deleted = FALSE
        AND payload->>'qrToken' = $1
      LIMIT 1`,
    [token],
  )
  const table = rows[0]?.payload
  if (!table) throw new PublicOrderError(404, 'Kode QR tidak dikenal.')
  if (table.qrActive !== true) throw new PublicOrderError(410, 'Kode QR ini sedang tidak aktif. Hubungi kasir.')
  return { tableId: String(table.id), tableName: String(table.name ?? 'Meja') }
}

export interface MenuResponse {
  cafe: { name: string; address: string; phone: string }
  table: { id: string; name: string }
  fiscal: { taxPercent: number; serviceChargePercent: number }
  categories: { id: string; name: string }[]
  items: {
    id: string
    categoryId: string
    name: string
    price: number
    photoDataUrl: string | null
    modifierGroups: {
      id: string
      name: string
      required: boolean
      multiSelect: boolean
      options: { id: string; name: string; priceDelta: number }[]
    }[]
  }[]
}

export function buildMenu(catalog: Catalog, table: ResolvedToken): MenuResponse {
  const optionsByGroup = new Map<string, CatalogModifierOption[]>()
  for (const o of catalog.modifierOptions) {
    const list = optionsByGroup.get(o.groupId) ?? []
    list.push(o)
    optionsByGroup.set(o.groupId, list)
  }
  const groupById = new Map(catalog.modifierGroups.map((g) => [g.id, g]))
  const activeCategoryIds = new Set(catalog.categories.filter((c) => c.active).map((c) => c.id))

  const items = catalog.products
    .filter((p) => p.isAvailable && activeCategoryIds.has(p.categoryId))
    .map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      price: p.price,
      photoDataUrl: p.photoDataUrl,
      modifierGroups: p.modifierGroupIds
        .map((gid) => groupById.get(gid))
        .filter((g): g is CatalogModifierGroup => !!g)
        .map((g) => ({
          id: g.id,
          name: g.name,
          required: g.required,
          multiSelect: g.multiSelect,
          options: (optionsByGroup.get(g.id) ?? [])
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })),
        })),
    }))

  const usedCategoryIds = new Set(items.map((i) => i.categoryId))
  const categories = catalog.categories
    .filter((c) => c.active && usedCategoryIds.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.id, name: c.name }))

  return {
    cafe: { name: catalog.settings.cafeName, address: catalog.settings.address, phone: catalog.settings.phone },
    table: { id: table.tableId, name: table.tableName },
    fiscal: {
      taxPercent: catalog.settings.taxPercent,
      serviceChargePercent: catalog.settings.serviceChargePercent,
    },
    categories,
    items,
  }
}

// ---- Perhitungan total (port dari src/lib/orderTotals.ts, subset jalur QR) ----

function roundToIncrement(amount: number, increment: number): number {
  if (increment <= 0) return Math.round(amount)
  return Math.round(amount / increment) * increment
}

export interface SubmitItemInput {
  productId: string
  qty: number
  modifierOptionIds: string[]
  note: string
}

interface PricedItem {
  productId: string
  productName: string
  unitPrice: number
  qty: number
  modifiers: { groupId: string; groupName: string; optionId: string; optionName: string; priceDelta: number }[]
  notes: string
  lineTotal: number
}

interface Quote {
  items: PricedItem[]
  subtotal: number
  serviceChargeAmount: number
  taxAmount: number
  roundingAdjustment: number
  grandTotal: number
}

const MAX_ITEMS = 40
const MAX_QTY = 99
const MAX_NOTE = 180

/** Bersihkan catatan pelanggan: buang karakter kontrol, batasi panjang. */
export function sanitizeNote(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let out = ''
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || c === 0x7f) out += ' '
    else if (ch === '<' || ch === '>') continue
    else out += ch
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE)
}

export function priceOrder(catalog: Catalog, items: SubmitItemInput[]): Quote {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PublicOrderError(400, 'Keranjang kosong.')
  }
  if (items.length > MAX_ITEMS) {
    throw new PublicOrderError(400, `Maksimal ${MAX_ITEMS} jenis item per pesanan.`)
  }

  const productById = new Map(catalog.products.map((p) => [p.id, p]))
  const optionById = new Map(catalog.modifierOptions.map((o) => [o.id, o]))
  const groupById = new Map(catalog.modifierGroups.map((g) => [g.id, g]))
  const activeCategoryIds = new Set(catalog.categories.filter((c) => c.active).map((c) => c.id))

  const priced: PricedItem[] = items.map((raw) => {
    const qty = Math.floor(num(raw.qty))
    if (qty < 1 || qty > MAX_QTY) throw new PublicOrderError(400, 'Jumlah item tidak valid.')
    const product = productById.get(String(raw.productId))
    if (!product || !product.isAvailable || !activeCategoryIds.has(product.categoryId)) {
      throw new PublicOrderError(409, 'Ada item yang sudah tidak tersedia. Muat ulang menu.')
    }
    const allowedGroups = new Set(product.modifierGroupIds)
    const modifiers = (Array.isArray(raw.modifierOptionIds) ? raw.modifierOptionIds : []).map((oid) => {
      const opt = optionById.get(String(oid))
      if (!opt || !allowedGroups.has(opt.groupId)) {
        throw new PublicOrderError(409, 'Pilihan varian tidak valid. Muat ulang menu.')
      }
      const group = groupById.get(opt.groupId)
      return {
        groupId: opt.groupId,
        groupName: group?.name ?? '',
        optionId: opt.id,
        optionName: opt.name,
        priceDelta: opt.priceDelta,
      }
    })
    const modTotal = modifiers.reduce((s, m) => s + m.priceDelta, 0)
    const lineTotal = Math.max(0, (product.price + modTotal) * qty)
    return {
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      qty,
      modifiers,
      notes: sanitizeNote(raw.note),
      lineTotal,
    }
  })

  const subtotal = priced.reduce((s, i) => s + i.lineTotal, 0)
  const sc = Math.round((subtotal * catalog.settings.serviceChargePercent) / 100)
  const tax = Math.round(((subtotal + sc) * catalog.settings.taxPercent) / 100)
  const preRounding = subtotal + sc + tax
  const grandTotal = roundToIncrement(preRounding, catalog.settings.roundingIncrement || 100)

  return {
    items: priced,
    subtotal: Math.round(subtotal),
    serviceChargeAmount: sc,
    taxAmount: tax,
    roundingAdjustment: Math.round(grandTotal - preRounding),
    grandTotal: Math.round(grandTotal),
  }
}

// ---- Penulisan order ke sync_entity_state ----

async function upsertEntity(
  client: PoolClient,
  entity: string,
  entityId: string,
  payload: unknown,
  entityUpdatedAt: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, nextval('sync_server_seq'), now())
     ON CONFLICT (entity, entity_id) DO UPDATE
       SET payload = EXCLUDED.payload,
           entity_updated_at = EXCLUDED.entity_updated_at,
           server_seq = nextval('sync_server_seq'),
           updated_at = now()`,
    [entity, entityId, JSON.stringify(payload), entityUpdatedAt],
  )
}

export interface SubmitResult {
  orderId: string
  orderNumber: string
  status: 'PENDING_CONFIRMATION'
  grandTotal: number
  subtotal: number
  taxAmount: number
  serviceChargeAmount: number
}

export async function submitPublicOrder(params: {
  token: string
  idempotencyKey: string
  customerName: string
  items: SubmitItemInput[]
  ip: string | null
}): Promise<SubmitResult> {
  return withTransaction(async (client) => {
    // Idempotency: kunci yang sama → kembalikan respons tersimpan.
    const prior = await client.query<{ response: SubmitResult }>(
      'SELECT response FROM public_order_idempotency WHERE idempotency_key = $1',
      [params.idempotencyKey],
    )
    if (prior.rows.length > 0) return prior.rows[0].response

    const token = await resolveToken(client, params.token)
    const catalog = await loadCatalog(client)
    const quote = priceOrder(catalog, params.items)

    const now = Date.now()
    const orderId = randomUUID()
    const seq = await client.query<{ n: string }>("SELECT nextval('qr_order_seq') AS n")
    const orderNumber = `QR${String(seq.rows[0].n).padStart(5, '0')}`
    const customerName = sanitizeNote(params.customerName).slice(0, 60)

    const order = {
      id: orderId,
      orderNumber,
      type: 'dine_in',
      tableId: token.tableId,
      customerId: null,
      queueNumber: null,
      guestCount: null,
      status: 'open',
      lifecycleStatus: 'PENDING_CONFIRMATION',
      subtotal: quote.subtotal,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      taxPercent: catalog.settings.taxPercent,
      taxAmount: quote.taxAmount,
      serviceChargePercent: catalog.settings.serviceChargePercent,
      serviceChargeAmount: quote.serviceChargeAmount,
      roundingIncrementSnapshot: catalog.settings.roundingIncrement || 100,
      roundingAdjustment: quote.roundingAdjustment,
      grandTotal: quote.grandTotal,
      shiftId: null,
      deviceId: 'qr-public',
      source: 'qr_table',
      cashierId: 'qr-public',
      cashierName: 'Pesanan QR',
      notes: customerName,
      idempotencyKey: params.idempotencyKey,
      parentOrderId: null,
      rejectedReason: null,
      voidReason: null,
      voidedBy: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
    }

    await upsertEntity(client, 'orders', orderId, order, now)

    let idx = 0
    for (const it of quote.items) {
      const itemId = randomUUID()
      const item = {
        id: itemId,
        orderId,
        productId: it.productId,
        productName: it.productName,
        unitPrice: it.unitPrice,
        qty: it.qty,
        modifiers: it.modifiers,
        notes: it.notes,
        discountAmount: 0,
        lineTotal: it.lineTotal,
        kitchenStatus: 'new',
        removed: false,
        kitchenPrintedAt: null,
        ticketId: null,
        queuedAt: now,
        startedAt: null,
        readyAt: null,
        servedAt: null,
        voided: false,
        voidReason: null,
        createdAt: now + idx,
        updatedAt: now + idx,
      }
      await upsertEntity(client, 'orderItems', itemId, item, now + idx)
      idx++
    }

    const result: SubmitResult = {
      orderId,
      orderNumber,
      status: 'PENDING_CONFIRMATION',
      grandTotal: quote.grandTotal,
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      serviceChargeAmount: quote.serviceChargeAmount,
    }

    await client.query(
      `INSERT INTO public_order_idempotency (idempotency_key, token, order_id, response)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [params.idempotencyKey, params.token, orderId, JSON.stringify(result)],
    )
    await logPublicRequest(client, 'POST /api/t/:token/orders', params.token, params.ip, 201, orderNumber)

    return result
  })
}

export interface PublicOrderStatus {
  orderNumber: string
  status: string
  queueNumber: number | null
  rejectedReason: string | null
  grandTotal: number
  items: { name: string; qty: number }[]
}

export async function getPublicOrderStatus(
  client: PoolClient,
  token: string,
  orderId: string,
): Promise<PublicOrderStatus> {
  const resolved = await resolveToken(client, token)
  const { rows } = await client.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM sync_entity_state WHERE entity = 'orders' AND entity_id = $1",
    [orderId],
  )
  const order = rows[0]?.payload
  if (!order || order.source !== 'qr_table' || String(order.tableId) !== resolved.tableId) {
    throw new PublicOrderError(404, 'Pesanan tidak ditemukan.')
  }
  const itemsRes = await client.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM sync_entity_state WHERE entity = 'orderItems' AND payload->>'orderId' = $1",
    [orderId],
  )
  return {
    orderNumber: String(order.orderNumber ?? ''),
    status: String(order.lifecycleStatus ?? ''),
    queueNumber: typeof order.queueNumber === 'number' ? order.queueNumber : null,
    rejectedReason: typeof order.rejectedReason === 'string' ? order.rejectedReason : null,
    grandTotal: num(order.grandTotal),
    items: itemsRes.rows
      .map((r) => r.payload)
      .filter((i) => i.voided !== true && i.removed !== true)
      .map((i) => ({ name: String(i.productName ?? ''), qty: num(i.qty, 1) })),
  }
}

export async function submitTableCall(params: {
  token: string
  type: 'waiter' | 'bill'
  ip: string | null
}): Promise<void> {
  await withTransaction(async (client) => {
    const table = await resolveToken(client, params.token)
    const now = Date.now()
    const id = randomUUID()
    const call = {
      id,
      tableId: table.tableId,
      type: params.type,
      status: 'pending',
      note: '',
      createdAt: now,
      updatedAt: now,
    }
    await upsertEntity(client, 'tableCalls', id, call, now)
    await logPublicRequest(client, 'POST /api/t/:token/calls', params.token, params.ip, 201, params.type)
  })
}

export async function logPublicRequest(
  client: PoolClient,
  route: string,
  token: string | null,
  ip: string | null,
  status: number,
  detail: string | null,
): Promise<void> {
  try {
    await client.query(
      'INSERT INTO public_request_log (route, token, ip, status, detail) VALUES ($1, $2, $3, $4, $5)',
      [route, token ? token.slice(0, 12) + '…' : null, ip, status, detail],
    )
  } catch {
    /* logging tak boleh menggagalkan permintaan */
  }
}
