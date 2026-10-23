import Dexie from 'dexie'
import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId, newIdempotencyKey } from '@/lib/id'
import { computeLineTotal, computeOrderTotals } from '@/lib/orderTotals'
import { getSettings, nextTransactionNumber, updateSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { markAvailable, occupyTable } from '@/db/repositories/tables'
import { consumeCancelCodeInTx, isOwnerCancelRequired, OwnerApprovalRequiredError, type OwnerApproval } from '@/db/repositories/cancelCodes'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { assertTransition, deriveKitchenPhase, legacyStatusFor } from '@/lib/orderState'
import { stationForCategory } from '@/db/repositories/printers'
import { getDeviceId } from '@/sync/device'
import { jakartaDateKey } from '@/lib/datetime'
import { getTrustedNow } from '@/lib/clockGuard'
import { evaluatePromos, normalizeVoucherCode, promoCustomerBlock, promoDiscountFor, isPromoActiveAt, usedUpPromoIds, type PromoCustomer } from '@/lib/promos'
import { loyaltySettingsOf } from '@/lib/loyalty'
import { getCustomerLoyalty } from '@/db/repositories/loyalty'
import type {
  AppliedPromo,
  ComboComponent,
  DiscountType,
  KitchenItemStatus,
  OnlinePlatform,
  Order,
  OrderItem,
  OrderItemModifierSnapshot,
  OrderLifecycleStatus,
  OrderSource,
  OrderType,
  Promo,
  VoidApproval,
} from '@/types/domain'

/**
 * Nomor antrean harian (reset otomatis tiap hari, atau manual lewat Pengaturan →
 * Antrean) untuk semua pesanan, dihitung dari data yang ada.
 */
export async function drawQueueNumber(): Promise<number> {
  const todayKey = jakartaDateKey(getTrustedNow())
  const resetAt = (await db.settings.get('singleton'))?.queueResetAt ?? 0
  const todaysOrders = await db.orders
    .filter(
      (o) =>
        o.queueNumber !== null &&
        jakartaDateKey(o.createdAt) === todayKey &&
        (o.queueAssignedAt ?? o.createdAt) >= resetAt,
    )
    .toArray()
  const maxQueue = todaysOrders.reduce((max, o) => Math.max(max, o.queueNumber ?? 0), 0)
  return maxQueue >= 999 ? 1 : maxQueue + 1
}

/**
 * Reset antrean manual: pesanan berikutnya kembali mendapat #1. Nomor pesanan yang
 * sudah ada tidak berubah. Ikut sync, jadi berlaku di semua tablet usaha ini.
 */
export async function resetQueueNumbers(actor: { userId: string; userName: string }): Promise<void> {
  const before = (await drawQueueNumber()) - 1
  await updateSettings({ queueResetAt: getTrustedNow() })
  await recordAuditLog({
    ...actor,
    action: 'queue.reset',
    entityType: 'settings',
    entityId: 'singleton',
    details: `Nomor antrean direset ke #1 (sebelumnya sampai #${before}).`,
  })
}

export class NoActiveShiftError extends Error {
  constructor() {
    super('Tidak ada shift aktif. Buka shift terlebih dahulu sebelum membuat pesanan.')
    this.name = 'NoActiveShiftError'
  }
}

export async function startOrder(params: {
  type: OrderType
  source?: OrderSource
  tableId?: string
  customerId?: string
  guestCount?: number
  notes?: string
  cashierId: string
  cashierName: string
  /** Pelayan yang melayani (kafe & restoran). Kosong = tidak dicatat. */
  waiter?: { id: string; name: string } | null
  /** Pesanan online (`type: 'delivery'`): platform & nomor pesanan di aplikasinya. */
  onlinePlatform?: OnlinePlatform
  onlineOrderRef?: string
  /** Pesanan terjadwal: kode voucher uang muka yang sudah dibayar tamu. */
  prepaidCode?: string | null
  shiftId: string
}): Promise<Order> {
  // Guard integritas: pesanan wajib terikat ke shift yang benar-benar terbuka —
  // tidak cukup mengandalkan UI menyembunyikan tombol.
  const shift = await db.shifts.get(params.shiftId)
  if (!shift || shift.status !== 'open') throw new NoActiveShiftError()

  const settings = await getSettings()
  const orderNumber = await nextTransactionNumber()
  const now = getTrustedNow()
  // Harga di aplikasi pesan-antar sudah final: tanpa service charge, pajak, & pembulatan
  // tambahan — supaya total POS sama persis dengan total di aplikasi platform.
  const online = params.type === 'delivery'
  const platform: OnlinePlatform | null = online ? (params.onlinePlatform ?? 'other') : null
  const order: Order = {
    id: newId(),
    orderNumber,
    type: params.type,
    tableId: params.tableId ?? null,
    customerId: params.customerId ?? null,
    queueNumber: await drawQueueNumber(),
    queueAssignedAt: now,
    guestCount: params.guestCount ?? null,
    status: 'open',
    lifecycleStatus: 'DRAFT',
    subtotal: 0,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    taxPercent: online ? 0 : settings.taxPercent,
    taxAmount: 0,
    serviceChargePercent: online ? 0 : settings.serviceChargePercent,
    serviceChargeAmount: 0,
    roundingIncrementSnapshot: online ? 1 : settings.roundingIncrement,
    roundingAdjustment: 0,
    grandTotal: 0,
    shiftId: params.shiftId,
    deviceId: getDeviceId(),
    outletId: settings.activeOutletId,
    source: params.source ?? (params.type === 'takeaway' ? 'takeaway' : params.type === 'delivery' ? 'delivery' : 'cashier'),
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    waiterId: params.waiter?.id ?? null,
    waiterName: params.waiter?.name ?? null,
    ...(platform
      ? {
          onlinePlatform: platform,
          onlineOrderRef: params.onlineOrderRef?.trim() || null,
          onlineCommissionPercent: Math.min(100, Math.max(0, settings.onlineCommissionPercent?.[platform] ?? 0)),
        }
      : {}),
    ...(params.prepaidCode ? { prepaidCode: params.prepaidCode } : {}),
    notes: params.notes?.trim() ?? '',
    idempotencyKey: newIdempotencyKey(),
    parentOrderId: null,
    pagerCalledAt: null,
    pagerNumber: null,
    rejectedReason: null,
    voidReason: null,
    voidedBy: null,
    voidedAt: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  }
  await db.transaction('rw', db.orders, db.cafeTables, db.syncQueue, async () => {
    await db.orders.add(order)
    await enqueueSync('orders', order.id, order)
    if (params.tableId) {
      await occupyTable(params.tableId, order.id, params.guestCount ?? 1)
    }
  })
  return order
}

export async function getOrder(orderId: string): Promise<Order | undefined> {
  return db.orders.get(orderId)
}

/**
 * Satu-satunya pintu perubahan status siklus hidup order. Memvalidasi transisi,
 * menyelaraskan `status` legacy, dan mendaftarkan ke sync. Harus dipanggil di
 * dalam transaksi yang mencakup `db.orders` & `db.syncQueue`.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderLifecycleStatus,
  extra: Partial<Order> = {},
): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  const from = order.lifecycleStatus ?? 'DRAFT'
  if (from === to && Object.keys(extra).length === 0) return
  assertTransition(from, to)
  await db.orders.update(orderId, {
    lifecycleStatus: to,
    status: legacyStatusFor(to),
    updatedAt: getTrustedNow(),
    ...extra,
  })
  const updated = await db.orders.get(orderId)
  if (updated) await enqueueSync('orders', orderId, updated)
}

/** Menaikkan status dapur order (CONFIRMED→…→SERVED) berdasarkan agregat status item. */
async function syncKitchenPhase(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) return
  const items = await db.orderItems
    .where('orderId')
    .equals(orderId)
    // Barang siap jual (skipKitchen) tak pernah lewat dapur — tak ikut menentukan fase.
    .filter((i) => !i.removed && !i.voided && !i.skipKitchen)
    .toArray()
  const derived = deriveKitchenPhase(
    order.lifecycleStatus ?? 'DRAFT',
    items.map((i) => i.kitchenStatus),
  )
  if (derived !== order.lifecycleStatus) {
    await db.orders.update(orderId, { lifecycleStatus: derived, updatedAt: getTrustedNow() })
    const updated = await db.orders.get(orderId)
    if (updated) await enqueueSync('orders', orderId, updated)
  }
}

export async function listOpenOrders(): Promise<Order[]> {
  return db.orders.where('status').equals('open').reverse().sortBy('createdAt')
}

export async function countActiveOrderItems(orderId: string): Promise<number> {
  return db.orderItems
    .where('orderId')
    .equals(orderId)
    .filter((i) => !i.removed && !i.voided)
    .count()
}

/**
 * Apa yang dibutuhkan untuk membatalkan pesanan kosong. Kantin (`ownerPinCancel`):
 * pesanan yang PERNAH berisi item wajib alasan, dan wajib kode Pemilik bila ada
 * item yang dihapus tanpa persetujuan Pemilik — menutup celah "kosongkan dulu,
 * lalu batalkan sebagai pesanan kosong" tanpa jejak.
 */
export async function emptyOrderCancelRequirements(
  orderId: string,
): Promise<{ hadItems: boolean; needsReason: boolean; needsOwnerCode: boolean }> {
  const items = await db.orderItems.where('orderId').equals(orderId).toArray()
  const hadItems = items.length > 0
  if (!(await isOwnerCancelRequired())) return { hadItems, needsReason: false, needsOwnerCode: false }
  return {
    hadItems,
    needsReason: hadItems,
    needsOwnerCode: items.some((i) => (i.removed || i.voided) && i.removedApproval !== 'owner_code'),
  }
}

/**
 * Membatalkan pesanan terbuka yang TIDAK punya item aktif — mis. dibuka lalu
 * tak jadi dipakai, atau semua itemnya dihapus/dibatalkan. Pesanan kosong ini
 * tetap berstatus `open` dan ikut memblokir penutupan shift
 * (`closeShift` di shifts.ts) sampai dibatalkan lewat sini. Melepas meja bila
 * dine-in. Pesanan yang masih punya item harus dibatalkan lewat `voidOrder`
 * (butuh persetujuan supervisor). Kantin: lihat `emptyOrderCancelRequirements`.
 */
export async function cancelEmptyOrder(
  orderId: string,
  actor: { userId: string; userName: string },
  opts: { reason?: string; ownerApproval?: OwnerApproval } = {},
): Promise<void> {
  const req = await emptyOrderCancelRequirements(orderId)
  const reason = opts.reason?.trim() ?? ''
  if (req.needsReason && !reason) throw new Error('Alasan pembatalan wajib diisi')
  if (req.needsOwnerCode && !opts.ownerApproval) throw new OwnerApprovalRequiredError()
  await db.transaction('rw', [db.orders, db.orderItems, db.cafeTables, db.cancelCodes, db.syncQueue, db.auditLogs], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    if (order.status !== 'open') throw new Error('Pesanan ini sudah tidak terbuka')
    const activeItemCount = await db.orderItems
      .where('orderId')
      .equals(orderId)
      .filter((i) => !i.removed && !i.voided)
      .count()
    if (activeItemCount > 0) {
      throw new Error('Pesanan masih berisi item. Kosongkan keranjang atau batalkan lewat menu Void (supervisor) dahulu.')
    }
    if (opts.ownerApproval) await consumeCancelCodeInTx(opts.ownerApproval)
    await closeOpenOrder(order, reason || 'Pesanan kosong dibatalkan', {
      approverId: opts.ownerApproval?.approverUserId ?? actor.userId,
      approverName: opts.ownerApproval?.approverName ?? actor.userName,
      requestedByName: actor.userName,
      approval: opts.ownerApproval ? 'owner_code' : 'self',
    })
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'order.cancelEmpty',
      entityType: 'order',
      entityId: orderId,
      details:
        (req.hadItems
          ? `Pesanan ${order.orderNumber} (semua item sudah dihapus) dibatalkan. Alasan: ${reason || '-'}`
          : `Pesanan kosong ${order.orderNumber} dibatalkan (tidak ada item).`) +
        (opts.ownerApproval ? ` • Disetujui Pemilik: ${opts.ownerApproval.approverName} (kode sekali pakai)` : ''),
    })
  })
}

/** Item sudah diteruskan ke dapur/bar (tiket tercetak atau sudah diproses dapur). */
export function isItemSentToKitchen(item: OrderItem): boolean {
  return !item.skipKitchen && (item.kitchenStatus !== 'new' || item.kitchenPrintedAt != null)
}

export class CancelNeedsApprovalError extends Error {
  constructor() {
    super('Pesanan ini sudah diteruskan ke dapur — pembatalan butuh persetujuan supervisor.')
    this.name = 'CancelNeedsApprovalError'
  }
}

/**
 * Membatalkan pesanan BELUM DIBAYAR yang belum ada itemnya diteruskan ke dapur
 * (salah input, pembeli tidak jadi). Boleh oleh kasir tanpa persetujuan —
 * belum ada uang masuk maupun bahan yang dimasak — tetapi alasan wajib dan
 * tercatat di log. Pesanan yang sudah di dapur atau sudah dibayar harus lewat
 * `voidOrder` (persetujuan supervisor).
 */
export async function cancelUnsentOrder(
  orderId: string,
  reason: string,
  actor: { userId: string; userName: string },
  /** Wajib bila `ownerPinCancel` aktif (kantin) — kodenya dihapus dalam transaksi yang sama. */
  ownerApproval?: OwnerApproval,
): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('Alasan pembatalan wajib diisi')
  if (!ownerApproval && (await isOwnerCancelRequired())) throw new OwnerApprovalRequiredError()
  await db.transaction('rw', [db.orders, db.orderItems, db.cafeTables, db.cancelCodes, db.syncQueue, db.auditLogs], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    if (order.status !== 'open') throw new Error('Pesanan ini sudah tidak terbuka')
    const items = await db.orderItems
      .where('orderId')
      .equals(orderId)
      .filter((i) => !i.removed && !i.voided)
      .toArray()
    if (items.some(isItemSentToKitchen)) throw new CancelNeedsApprovalError()
    if (ownerApproval) await consumeCancelCodeInTx(ownerApproval)
    await closeOpenOrder(order, trimmed, {
      approverId: ownerApproval?.approverUserId ?? actor.userId,
      approverName: ownerApproval?.approverName ?? actor.userName,
      requestedByName: actor.userName,
      approval: ownerApproval ? 'owner_code' : 'self',
    })
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'order.cancel',
      entityType: 'order',
      entityId: orderId,
      details:
        `Pesanan ${order.orderNumber} (belum dibayar, ${items.length} item) dibatalkan. Alasan: ${trimmed}` +
        (ownerApproval ? ` • Disetujui Pemilik: ${ownerApproval.approverName} (kode sekali pakai)` : ''),
    })
  })
}

/**
 * "Tagihan Tertunda" (kantin, flag `payLater`): pesanan internal yang dicatat sekarang
 * dan dibayar nanti. Order tetap `open` — dilunasi lewat alur bayar biasa — tapi
 * tak menghalangi tutup shift (lihat `closeShift`) dan pelunasannya masuk ke shift
 * yang sedang buka saat dibayar (lihat `payBill`).
 */
export async function markOrderPayLater(
  orderId: string,
  params: { name: string; note: string; shiftId: string | null },
  actor: { userId: string; userName: string },
): Promise<Order> {
  const name = params.name.trim()
  if (!name) throw new Error('Nama penanggung tagihan tertunda wajib diisi')
  return db.transaction('rw', [db.orders, db.orderItems, db.cafeTables, db.syncQueue, db.auditLogs], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    if (order.status !== 'open') throw new Error('Pesanan ini sudah tidak terbuka')
    const itemCount = await db.orderItems
      .where('orderId')
      .equals(orderId)
      .filter((i) => !i.removed && !i.voided)
      .count()
    if (itemCount === 0) throw new Error('Pesanan kosong tidak bisa dijadikan tagihan tertunda')
    const now = getTrustedNow()
    const updated: Order = {
      ...order,
      payLater: {
        name,
        note: params.note.trim(),
        markedAt: order.payLater?.markedAt ?? now,
        markedByUserId: actor.userId,
        markedByName: actor.userName,
        shiftId: order.payLater?.shiftId ?? params.shiftId,
      },
      updatedAt: now,
    }
    await db.orders.put(updated)
    await enqueueSync('orders', orderId, updated)
    // Kafe: tamu dine-in pergi tanpa membayar sekarang → meja dilepas untuk dibersihkan.
    if (order.tableId) {
      const table = await db.cafeTables.get(order.tableId)
      if (table && table.currentOrderId === orderId) {
        await db.cafeTables.update(order.tableId, {
          status: 'needs_cleaning',
          currentOrderId: null,
          occupiedSince: null,
          guestCount: null,
          updatedAt: now,
        })
        const t = await db.cafeTables.get(order.tableId)
        if (t) await enqueueSync('cafeTables', order.tableId, t)
      }
    }
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'order.pay_later',
      entityType: 'order',
      entityId: orderId,
      details: `Pesanan ${order.orderNumber} (${itemCount} item) dicatat sebagai tagihan tertunda atas nama ${name}.`,
    })
    return updated
  })
}

/** Tagihan tertunda yang belum lunas. */
export function isOpenPayLater(order: Order): boolean {
  return order.status === 'open' && !!order.payLater
}

/** Menutup pesanan terbuka sebagai batal (CANCELLED bila masih draft) & melepas mejanya. */
async function closeOpenOrder(
  order: Order,
  reason: string,
  by: { approverId: string; approverName: string; requestedByName: string; approval: VoidApproval },
): Promise<void> {
  const from = order.lifecycleStatus ?? 'DRAFT'
  const to: OrderLifecycleStatus = from === 'DRAFT' || from === 'PENDING_CONFIRMATION' ? 'CANCELLED' : 'VOIDED'
  await transitionOrder(order.id, to, {
    voidReason: reason,
    voidedBy: by.approverId,
    voidedAt: getTrustedNow(),
    voidedByName: by.approverName,
    voidRequestedByName: by.requestedByName,
    voidApproval: by.approval,
  })
  if (order.tableId) {
    const table = await db.cafeTables.get(order.tableId)
    if (table && table.currentOrderId === order.id) {
      await markAvailable(order.tableId)
    }
  }
}

export async function listOrderItems(orderId: string): Promise<OrderItem[]> {
  return db.orderItems.where('orderId').equals(orderId).sortBy('createdAt')
}

/** `groupId` baris modifier yang mewakili isi menu paket. */
export const COMBO_GROUP_ID = 'combo'

export async function addOrderItem(params: {
  orderId: string
  productId: string
  productName: string
  unitPrice: number
  qty: number
  modifiers: OrderItemModifierSnapshot[]
  notes: string
  discountAmount?: number
  /** Menu paket: isi per 1 paket (stok dipotong per komponen). */
  comboComponents?: ComboComponent[]
}): Promise<OrderItem> {
  const now = getTrustedNow()
  const lineTotal = computeLineTotal({
    unitPrice: params.unitPrice,
    qty: params.qty,
    modifiers: params.modifiers,
    discountAmount: params.discountAmount ?? 0,
  })
  const product = await db.products.get(params.productId)
  const skipKitchen = (await stationForCategory(product?.categoryId ?? null)) === 'direct'
  // Menu paket: snapshot isinya dari master produk. Isi paket juga dicatat sebagai
  // baris "Isi paket" supaya ikut tercetak di tiket dapur & struk tanpa kode khusus.
  let comboComponents = params.comboComponents
  if (!comboComponents?.length && product?.comboItems?.length) {
    comboComponents = []
    for (const c of product.comboItems) {
      const component = await db.products.get(c.productId)
      if (component) comboComponents.push({ productId: component.id, name: component.name, qty: c.qty })
    }
  }
  const modifiers: OrderItemModifierSnapshot[] = [
    ...(comboComponents ?? [])
      .filter((c) => !params.modifiers.some((m) => m.groupId === COMBO_GROUP_ID && m.optionId === c.productId))
      .map((c) => ({ groupId: COMBO_GROUP_ID, groupName: 'Isi paket', optionId: c.productId, optionName: `${c.qty}× ${c.name}`, priceDelta: 0 })),
    ...params.modifiers,
  ]
  const item: OrderItem = {
    id: newId(),
    orderId: params.orderId,
    productId: params.productId,
    productName: params.productName,
    unitPrice: params.unitPrice,
    qty: params.qty,
    modifiers,
    notes: params.notes,
    discountAmount: params.discountAmount ?? 0,
    lineTotal,
    categoryId: product?.categoryId ?? null,
    ...(comboComponents?.length ? { comboComponents } : {}),
    kitchenStatus: skipKitchen ? 'done' : 'new',
    skipKitchen,
    removed: false,
    kitchenPrintedAt: null,
    ticketId: null,
    queuedAt: now,
    startedAt: null,
    readyAt: skipKitchen ? now : null,
    servedAt: skipKitchen ? now : null,
    voided: false,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction(
    'rw',
    [db.orderItems, db.orders, db.syncQueue, db.settings, db.customers],
    async () => {
      // Tiket dapur & cetak dibuat saat item di-"Kirim ke Dapur/Bar"
      // (sendOrderToKitchen) — bukan saat item ditambahkan. Item baru mulai
      // dengan ticketId null & kitchenPrintedAt null hingga di-dispatch.
      await db.orderItems.add(item)
      await enqueueSync('orderItems', item.id, item)
      // Item pertama mengkonfirmasi order. Kafe: tanpa tombol terpisah —
      // menambah item = mengkonfirmasi order (DRAFT -> CONFIRMED).
      const order = await db.orders.get(params.orderId)
      if (order && (order.lifecycleStatus ?? 'DRAFT') === 'DRAFT') {
        await transitionOrder(params.orderId, 'CONFIRMED')
      }
      await recalcOrderTotals(params.orderId)
    },
  )
  return item
}

/**
 * Koreksi item (kantin, `ownerPinCancel`): menghapus atau MENGURANGI item wajib
 * alasan, tercatat di item & log aktivitas (terlihat di konsol /ops). Menambah
 * qty tetap bebas.
 */
export interface ItemCorrection {
  reason: string
  actor: { userId: string; userName: string }
}

export class ItemCorrectionReasonRequiredError extends Error {
  constructor() {
    super('Alasan wajib diisi untuk menghapus atau mengurangi item.')
    this.name = 'ItemCorrectionReasonRequiredError'
  }
}

async function assertCorrectionReason(correction: ItemCorrection | undefined): Promise<void> {
  if (correction?.reason.trim()) return
  if (await isOwnerCancelRequired()) throw new ItemCorrectionReasonRequiredError()
}

/**
 * Mengubah catatan satu item (mis. "tidak pakai saos"). Hanya untuk item yang
 * belum dikirim ke dapur — catatan baru tak akan sampai ke tiket yang sudah tercetak.
 */
export async function updateOrderItemNotes(itemId: string, notes: string): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  if (!item.skipKitchen && (item.kitchenPrintedAt != null || item.kitchenStatus !== 'new')) {
    throw new Error('Item sudah dikirim ke dapur — catatan tidak bisa diubah lagi.')
  }
  const clean = notes.trim().replace(/\s+/g, ' ').slice(0, 200)
  await db.transaction('rw', [db.orderItems, db.syncQueue], async () => {
    await db.orderItems.update(itemId, { notes: clean, updatedAt: getTrustedNow() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
  })
}

export async function updateOrderItemQty(itemId: string, qty: number, correction?: ItemCorrection): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  const reducing = qty < item.qty
  if (reducing) await assertCorrectionReason(correction)
  const lineTotal = computeLineTotal({
    unitPrice: item.unitPrice,
    qty,
    modifiers: item.modifiers,
    discountAmount: item.discountAmount,
  })
  await db.transaction('rw', [db.orderItems, db.orders, db.syncQueue, db.settings, db.customers, db.auditLogs], async () => {
    const lost = Math.max(0, item.lineTotal - lineTotal)
    await db.orderItems.update(itemId, {
      qty,
      lineTotal,
      updatedAt: getTrustedNow(),
      ...(reducing ? { reducedValue: (item.reducedValue ?? 0) + lost } : {}),
    })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
    if (reducing && correction?.reason.trim()) {
      const order = await db.orders.get(item.orderId)
      await recordAuditLog({
        userId: correction.actor.userId,
        userName: correction.actor.userName,
        action: 'order.item_reduce',
        entityType: 'order',
        entityId: item.orderId,
        details: `"${item.productName}" dikurangi ${item.qty} → ${qty} (−Rp${lost}) di ${order?.orderNumber ?? 'pesanan'}. Alasan: ${correction.reason.trim()}`,
      })
    }
  })
}

export async function setOrderItemDiscount(itemId: string, discountAmount: number): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  const lineTotal = computeLineTotal({
    unitPrice: item.unitPrice,
    qty: item.qty,
    modifiers: item.modifiers,
    discountAmount,
  })
  await db.transaction('rw', [db.orderItems, db.orders, db.syncQueue, db.settings, db.customers], async () => {
    await db.orderItems.update(itemId, { discountAmount, lineTotal, updatedAt: getTrustedNow() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
  })
}

/**
 * Menghapus item yang BELUM dikirim ke dapur. Soft-delete (`removed: true`) —
 * bukan hard delete — supaya penghapusan terwakili di sinkronisasi dan tak ada
 * data transaksi yang lenyap tanpa jejak.
 */
export async function removeOrderItem(itemId: string, correction?: ItemCorrection): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item || item.removed) return
  await assertCorrectionReason(correction)
  const reason = correction?.reason.trim() || null
  await db.transaction('rw', [db.orderItems, db.orders, db.syncQueue, db.settings, db.customers, db.auditLogs], async () => {
    const now = getTrustedNow()
    await db.orderItems.update(itemId, {
      removed: true,
      updatedAt: now,
      ...(reason
        ? { removedReason: reason, removedByName: correction!.actor.userName, removedAt: now, removedApproval: 'reason' as const }
        : {}),
    })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
    if (reason) {
      const order = await db.orders.get(item.orderId)
      await recordAuditLog({
        userId: correction!.actor.userId,
        userName: correction!.actor.userName,
        action: 'order.item_remove',
        entityType: 'order',
        entityId: item.orderId,
        details: `"${item.productName}" ×${item.qty} (Rp${item.lineTotal}) dihapus dari ${order?.orderNumber ?? 'pesanan'}. Alasan: ${reason}`,
      })
    }
  })
}

/**
 * "Kosongkan" (kantin): hapus semua item yang belum ke dapur sekaligus — wajib
 * alasan + kode Pemilik (dihanguskan di transaksi yang sama). Item ditandai
 * `removedApproval: 'owner_code'`, jadi membatalkan pesanan kosongnya setelah ini
 * cukup dengan alasan.
 */
export async function clearOrderItems(
  orderId: string,
  reason: string,
  actor: { userId: string; userName: string },
  ownerApproval?: OwnerApproval,
): Promise<number> {
  const trimmed = reason.trim()
  if (!trimmed) throw new ItemCorrectionReasonRequiredError()
  if (!ownerApproval && (await isOwnerCancelRequired())) throw new OwnerApprovalRequiredError()
  return db.transaction('rw', [db.orders, db.orderItems, db.cancelCodes, db.syncQueue, db.settings, db.customers, db.auditLogs], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    if (order.status !== 'open') throw new Error('Pesanan ini sudah tidak terbuka')
    const items = await db.orderItems
      .where('orderId')
      .equals(orderId)
      .filter((i) => !i.removed && !i.voided && i.kitchenStatus === 'new')
      .toArray()
    if (items.length === 0) return 0
    if (ownerApproval) await consumeCancelCodeInTx(ownerApproval)
    const now = getTrustedNow()
    for (const item of items) {
      await db.orderItems.update(item.id, {
        removed: true,
        removedReason: trimmed,
        removedByName: actor.userName,
        removedAt: now,
        removedApproval: ownerApproval ? 'owner_code' : 'reason',
        updatedAt: now,
      })
      const updated = await db.orderItems.get(item.id)
      if (updated) await enqueueSync('orderItems', item.id, updated)
    }
    await recalcOrderTotals(orderId)
    const value = items.reduce((s, i) => s + i.lineTotal, 0)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'order.clear',
      entityType: 'order',
      entityId: orderId,
      details:
        `Keranjang ${order.orderNumber} dikosongkan (${items.length} item, Rp${value}). Alasan: ${trimmed}` +
        (ownerApproval ? ` • Disetujui Pemilik: ${ownerApproval.approverName} (kode sekali pakai)` : ''),
    })
    return items.length
  })
}

/**
 * Membatalkan satu item pesanan (tetap tersimpan untuk dapur & audit). Item yang
 * SUDAH dikirim ke dapur (`kitchenStatus !== 'new'`) wajib disertai penyetuju
 * supervisor — dipaksa oleh tipe: `approver` wajib bila item sudah diproses.
 */
export async function voidOrderItem(
  itemId: string,
  reason: string,
  approver?: { userId: string; userName: string },
): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item || item.voided) return
  const wasSentToKitchen = item.kitchenStatus !== 'new'
  if (wasSentToKitchen && !approver) {
    throw new Error('Membatalkan item yang sudah dikirim ke dapur butuh persetujuan supervisor.')
  }
  await db.transaction(
    'rw',
    [db.orderItems, db.orders, db.syncQueue, db.settings, db.customers, db.auditLogs],
    async () => {
      await db.orderItems.update(itemId, { voided: true, voidReason: reason, updatedAt: getTrustedNow() })
      const updated = await db.orderItems.get(itemId)
      if (updated) await enqueueSync('orderItems', itemId, updated)
      await recalcOrderTotals(item.orderId)
      if (wasSentToKitchen && approver) {
        await recordAuditLog({
          userId: approver.userId,
          userName: approver.userName,
          action: 'orderItem.void',
          entityType: 'orderItem',
          entityId: itemId,
          details: `Item "${item.productName}" (sudah di dapur) dibatalkan. Alasan: ${reason}`,
        })
      }
    },
  )
}

export const DEFAULT_CASHIER_DISCOUNT_MAX_PERCENT = 10

export class DiscountReasonRequiredError extends Error {
  constructor() {
    super('Alasan diskon wajib diisi.')
    this.name = 'DiscountReasonRequiredError'
  }
}

/** Persen efektif sebuah diskon terhadap subtotal pesanan. */
export function effectiveDiscountPercent(subtotal: number, type: DiscountType | null, value: number): number {
  if (!type || value <= 0 || subtotal <= 0) return 0
  return type === 'percent' ? value : (value / subtotal) * 100
}

/** Kantin (`cashierControls`): apakah diskon ini butuh alasan / kode Pemilik. */
export async function discountRequirements(
  orderId: string,
  type: DiscountType | null,
  value: number,
): Promise<{ controlled: boolean; percent: number; maxPercent: number; needsOwnerCode: boolean }> {
  const settings = await getSettings()
  const controlled = featuresForBusinessType(settings.businessType).cashierControls
  const maxPercent = settings.cashierDiscountMaxPercent ?? DEFAULT_CASHIER_DISCOUNT_MAX_PERCENT
  const order = await db.orders.get(orderId)
  const percent = effectiveDiscountPercent(order?.subtotal ?? 0, type, value)
  return { controlled, percent, maxPercent, needsOwnerCode: controlled && percent > maxPercent + 1e-9 }
}

/**
 * Memasang/menghapus diskon pesanan. Kantin: diskon wajib alasan (tercatat siapa,
 * berapa, alasan), dan di atas batas wajib kode Pemilik yang dihanguskan dalam
 * transaksi yang sama. Menghapus diskon selalu bebas (harga justru naik).
 */
export async function setOrderDiscount(
  orderId: string,
  discountType: DiscountType | null,
  discountValue: number,
  control?: { reason: string; actor: { userId: string; userName: string }; ownerApproval?: OwnerApproval },
): Promise<void> {
  const removing = !discountType || discountValue <= 0
  const req = await discountRequirements(orderId, discountType, discountValue)
  const reason = control?.reason.trim() ?? ''
  if (!removing && req.controlled) {
    if (!reason) throw new DiscountReasonRequiredError()
    if (req.needsOwnerCode && !control?.ownerApproval) throw new OwnerApprovalRequiredError(
      `Diskon ${req.percent.toFixed(1)}% melebihi batas ${req.maxPercent}% — butuh kode Pemilik.`,
    )
  }
  await db.transaction('rw', [db.orders, db.orderItems, db.cancelCodes, db.syncQueue, db.settings, db.customers, db.auditLogs], async () => {
    const before = await db.orders.get(orderId)
    if (!removing && control?.ownerApproval && req.needsOwnerCode) await consumeCancelCodeInTx(control.ownerApproval)
    await db.orders.update(orderId, {
      discountType: removing ? null : discountType,
      discountValue: removing ? 0 : discountValue,
      discountReason: removing ? null : reason || null,
      discountByName: removing ? null : control?.actor.userName ?? null,
      discountApproval: removing ? null : control ? (control.ownerApproval && req.needsOwnerCode ? 'owner_code' : 'self') : null,
      updatedAt: getTrustedNow(),
    })
    await recalcOrderTotals(orderId)
    const after = await db.orders.get(orderId)
    if (control && after && (!removing || (before?.discountAmount ?? 0) > 0)) {
      await recordAuditLog({
        userId: control.actor.userId,
        userName: control.actor.userName,
        action: removing ? 'order.discount_remove' : 'order.discount',
        entityType: 'order',
        entityId: orderId,
        details: removing
          ? `Diskon ${after.orderNumber} dihapus.`
          : `Diskon ${after.orderNumber}: Rp${Math.round(after.discountAmount)} (${req.percent.toFixed(1)}%). Alasan: ${reason}` +
            (control.ownerApproval && req.needsOwnerCode ? ` • Disetujui Pemilik: ${control.ownerApproval.approverName} (kode sekali pakai)` : ''),
      })
    }
  })
}

const KITCHEN_TIMESTAMP_FIELD: Partial<Record<KitchenItemStatus, keyof OrderItem>> = {
  in_progress: 'startedAt',
  ready: 'readyAt',
  done: 'servedAt',
}

export async function setOrderItemKitchenStatus(itemId: string, kitchenStatus: KitchenItemStatus): Promise<void> {
  await db.transaction('rw', [db.orderItems, db.orders, db.syncQueue], async () => {
    const item = await db.orderItems.get(itemId)
    if (!item) return
    const now = getTrustedNow()
    const patch: Partial<OrderItem> = { kitchenStatus, updatedAt: now }
    const tsField = KITCHEN_TIMESTAMP_FIELD[kitchenStatus]
    if (tsField && item[tsField] == null) (patch as Record<string, unknown>)[tsField] = now
    await db.orderItems.update(itemId, patch)
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await syncKitchenPhase(item.orderId)
  })
}

export async function listActiveKitchenItems(): Promise<OrderItem[]> {
  return db.orderItems
    .where('kitchenStatus')
    .notEqual('done')
    .and((item) => !item.removed)
    .sortBy('createdAt')
}

/** Menandai urutan saji sebuah item (null = tanpa tahap). Hanya selama item belum dikirim ke dapur. */
export async function setOrderItemCourse(itemId: string, course: number | null): Promise<void> {
  await db.transaction('rw', db.orderItems, db.syncQueue, async () => {
    const item = await db.orderItems.get(itemId)
    if (!item) return
    if (isItemSentToKitchen(item)) throw new Error('Item sudah dikirim ke dapur — urutan saji tak bisa diubah.')
    const updated = { ...item, course: course != null && course >= 1 && course <= 3 ? Math.floor(course) : null, updatedAt: getTrustedNow() }
    await db.orderItems.put(updated)
    await enqueueSync('orderItems', itemId, updated)
  })
}

export async function setOrderNotes(orderId: string, notes: string): Promise<void> {
  await db.orders.update(orderId, { notes, updatedAt: getTrustedNow() })
}

/** Menetapkan / mengganti pelayan sebuah pesanan (`null` = kosongkan). */
export async function setOrderWaiter(orderId: string, waiter: { id: string; name: string } | null): Promise<void> {
  await db.transaction('rw', db.orders, db.syncQueue, async () => {
    await db.orders.update(orderId, {
      waiterId: waiter?.id ?? null,
      waiterName: waiter?.name ?? null,
      updatedAt: getTrustedNow(),
    })
    const updated = await db.orders.get(orderId)
    if (updated) await enqueueSync('orders', orderId, updated)
  })
}

/**
 * Mencatat bahwa tagihan sementara (pre-bill) dicetak: menaikkan hitungan cetak,
 * menandai meja "menunggu pembayaran", dan menulis audit log — tagihan yang
 * dicetak berulang kali layak terlihat oleh Pemilik.
 */
export async function markBillPrinted(orderId: string, actor: { userId: string; userName: string }): Promise<number> {
  return db.transaction('rw', db.orders, db.cafeTables, db.syncQueue, db.auditLogs, async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    if (order.status !== 'open') throw new Error('Tagihan hanya bisa dicetak untuk pesanan yang belum dibayar.')
    const now = getTrustedNow()
    const count = (order.billPrintCount ?? 0) + 1
    await db.orders.update(orderId, { billPrintedAt: now, billPrintCount: count, updatedAt: now })
    const updated = await db.orders.get(orderId)
    if (updated) await enqueueSync('orders', orderId, updated)

    if (order.tableId) {
      const table = await db.cafeTables.get(order.tableId)
      if (table && table.currentOrderId === orderId && table.status === 'occupied') {
        await db.cafeTables.update(order.tableId, { status: 'awaiting_payment', updatedAt: now })
        const t = await db.cafeTables.get(order.tableId)
        if (t) await enqueueSync('cafeTables', order.tableId, t)
      }
    }
    await recordAuditLog({
      ...actor,
      action: 'order.bill.print',
      entityType: 'order',
      entityId: orderId,
      details: `Tagihan sementara ${order.orderNumber} dicetak (ke-${count}).`,
    })
    return count
  })
}

/**
 * Data pelanggan untuk syarat promo (khusus member, sekali per member, ulang
 * tahun): pelanggan pesanan ini + promo yang jatahnya sudah ia habiskan di
 * transaksi lunas sebelumnya.
 */
async function promoEligibilityFor(order: Order, promos: Promo[], now: number): Promise<{ customer: PromoCustomer | null; usedPromoIds: Set<string> }> {
  if (!order.customerId) return { customer: null, usedPromoIds: new Set() }
  const customerId = order.customerId
  const tx = Dexie.currentTransaction
  const record = !tx || tx.storeNames.includes('customers') ? await db.customers.get(customerId) : undefined
  const customer: PromoCustomer = { id: customerId, birthDate: record?.birthDate ?? null }
  if (!promos.some((p) => p.oncePerCustomer || p.birthday)) return { customer, usedPromoIds: new Set() }
  const usages: { promoId: string; at: number }[] = []
  await db.orders
    .where('status')
    .anyOf(['paid', 'completed'])
    .filter((o) => o.customerId === customerId && o.id !== order.id)
    .each((o) => {
      for (const a of o.appliedPromos ?? []) usages.push({ promoId: a.promoId, at: o.paidAt ?? o.createdAt })
    })
  return { customer, usedPromoIds: usedUpPromoIds(promos, usages, now) }
}

export async function recalcOrderTotals(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) return
  const items = await db.orderItems.where('orderId').equals(orderId).toArray()

  // Promo & voucher dievaluasi ulang selama pesanan masih terbuka (isi keranjang
  // & jam happy hour bisa berubah); setelah lunas, snapshot-nya dibekukan. Dilewati
  // bila transaksi pemanggil tak menyertakan tabel pengaturan.
  let appliedPromos: AppliedPromo[] = order.appliedPromos ?? []
  const tx = Dexie.currentTransaction
  if (order.status === 'open' && (!tx || tx.storeNames.includes('settings'))) {
    const settings = await getSettings()
    const promos = settings.promos ?? []
    const now = getTrustedNow()
    const eligibility = await promoEligibilityFor(order, promos, now)
    appliedPromos = featuresForBusinessType(settings.businessType).promos
      ? evaluatePromos({ promos, items, orderType: order.type, now, voucherCode: order.voucherCode, kols: settings.kols, ...eligibility })
      : []
  }
  const activeSubtotal = items.filter((i) => !i.voided && !i.removed).reduce((s, i) => s + i.lineTotal, 0)
  const promoTotal = Math.min(activeSubtotal, appliedPromos.reduce((s, p) => s + p.amount, 0))
  const pointsDiscount = Math.min(Math.max(0, activeSubtotal - promoTotal), (order.pointsRedeemed ?? 0) * (order.pointsRedeemValue ?? 0))
  const extraDiscount = promoTotal + pointsDiscount

  const totals = computeOrderTotals({
    items,
    discountType: order.discountType,
    discountValue: order.discountValue,
    taxPercent: order.taxPercent,
    serviceChargePercent: order.serviceChargePercent,
    // Snapshot pembulatan milik order — bukan setelan live — supaya perubahan
    // setelan tak menggeser total order lama saat di-recalc.
    roundingIncrement: order.roundingIncrementSnapshot ?? (await getSettings()).roundingIncrement,
    extraDiscount,
  })
  const hasPromoData = extraDiscount > 0 || order.appliedPromos != null || order.promoDiscountAmount != null
  await db.orders.update(orderId, {
    ...totals,
    ...(hasPromoData ? { appliedPromos, promoDiscountAmount: extraDiscount } : {}),
    updatedAt: getTrustedNow(),
  })
  const updated = await db.orders.get(orderId)
  if (updated) await enqueueSync('orders', orderId, updated)
}

export class VoucherError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoucherError'
  }
}

/**
 * Memasang kode voucher (kosong = melepas). Ditolak dengan alasan yang jelas bila
 * kode tak dikenal, di luar jadwal, kuota habis, atau syarat belanja belum terpenuhi.
 */
export async function setOrderVoucher(orderId: string, code: string | null): Promise<AppliedPromo | null> {
  const normalized = normalizeVoucherCode(code)
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  if (normalized) {
    const settings = await getSettings()
    const voucher = (settings.promos ?? []).find((p) => normalizeVoucherCode(p.voucherCode) === normalized)
    if (!voucher || !voucher.active) throw new VoucherError('Kode voucher tidak dikenal atau sudah nonaktif.')
    if (!isPromoActiveAt(voucher, getTrustedNow(), order.type)) throw new VoucherError('Voucher tidak berlaku pada waktu atau jenis pesanan ini.')
    const eligibility = await promoEligibilityFor(order, [voucher], getTrustedNow())
    const blocked = promoCustomerBlock(voucher, eligibility.customer, eligibility.usedPromoIds, getTrustedNow())
    if (blocked) throw new VoucherError(blocked.replace(/^Promo/, 'Voucher').replace('promo ini', 'voucher ini'))
    if (voucher.usageLimit && voucher.usageLimit > 0) {
      const used = await db.orders
        .where('status')
        .anyOf(['paid', 'completed'])
        .filter((o) => (o.appliedPromos ?? []).some((a) => a.promoId === voucher.id))
        .count()
      if (used >= voucher.usageLimit) throw new VoucherError(`Kuota voucher sudah habis (${voucher.usageLimit}× terpakai).`)
    }
    const items = await db.orderItems.where('orderId').equals(orderId).toArray()
    if (promoDiscountFor(voucher, items) <= 0) {
      throw new VoucherError(
        voucher.minSubtotal ? `Syarat voucher belum terpenuhi (min. belanja Rp${voucher.minSubtotal.toLocaleString('id-ID')} / item yang sesuai).` : 'Belum ada item yang memenuhi syarat voucher ini.',
      )
    }
  }
  await db.transaction('rw', [db.orders, db.orderItems, db.syncQueue, db.settings, db.customers], async () => {
    await db.orders.update(orderId, { voucherCode: normalized || null, updatedAt: getTrustedNow() })
    await recalcOrderTotals(orderId)
  })
  const updated = await db.orders.get(orderId)
  return updated?.appliedPromos?.find((a) => a.voucherCode === normalized && normalized) ?? null
}

/** Mengaitkan/melepas pelanggan terdaftar (member). Melepas pelanggan ikut membatalkan tukar poin. */
export async function setOrderCustomer(orderId: string, customerId: string | null): Promise<void> {
  await db.transaction('rw', [db.orders, db.orderItems, db.syncQueue, db.settings, db.customers], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    const changed = order.customerId !== customerId
    await db.orders.update(orderId, {
      customerId,
      ...(changed ? { pointsRedeemed: 0, pointsRedeemValue: 0 } : {}),
      updatedAt: getTrustedNow(),
    })
    await recalcOrderTotals(orderId)
  })
}

/**
 * Menukar poin member jadi potongan di pesanan ini (0 = batal tukar). Poin yang
 * sedang dipakai di pesanan terbuka lain ikut diperhitungkan agar tak terpakai dua kali.
 */
export async function setOrderPointsRedeem(orderId: string, points: number): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  const want = Math.max(0, Math.floor(points))
  const settings = await getSettings()
  const loyalty = loyaltySettingsOf(settings)
  if (want > 0) {
    if (!loyalty.enabled || !featuresForBusinessType(settings.businessType).loyalty) throw new Error('Program member belum diaktifkan.')
    if (!order.customerId) throw new Error('Pilih pelanggan member terlebih dahulu.')
    if (want < loyalty.minRedeem) throw new Error(`Minimal tukar ${loyalty.minRedeem} poin.`)
    const info = await getCustomerLoyalty(order.customerId, orderId)
    if (want > info.available) throw new Error(`Poin tidak cukup — tersedia ${info.available} poin.`)
  }
  await db.transaction('rw', [db.orders, db.orderItems, db.syncQueue, db.settings, db.customers], async () => {
    await db.orders.update(orderId, { pointsRedeemed: want, pointsRedeemValue: want > 0 ? loyalty.pointValue : 0, updatedAt: getTrustedNow() })
    await recalcOrderTotals(orderId)
  })
}

/** Memisahkan sebagian item ke pesanan baru (split bill). */
export async function splitOrder(orderId: string, itemIdsToMove: string[]): Promise<Order> {
  return db.transaction('rw', [db.orders, db.orderItems, db.cafeTables, db.syncQueue, db.settings, db.customers], async () => {
    const original = await db.orders.get(orderId)
    if (!original) throw new Error('Pesanan tidak ditemukan')
    const orderNumber = await nextTransactionNumber()
    const now = getTrustedNow()
    const newOrder: Order = {
      ...original,
      id: newId(),
      orderNumber,
      parentOrderId: original.id,
      idempotencyKey: newIdempotencyKey(),
      deviceId: getDeviceId(),
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      status: 'open',
      lifecycleStatus: original.lifecycleStatus === 'DRAFT' ? 'DRAFT' : 'CONFIRMED',
      rejectedReason: null,
      pagerCalledAt: null,
      pagerNumber: null,
      queueNumber: await drawQueueNumber(),
      queueAssignedAt: now,
    }
    await db.orders.add(newOrder)
    await enqueueSync('orders', newOrder.id, newOrder)
    for (const itemId of itemIdsToMove) {
      await db.orderItems.update(itemId, { orderId: newOrder.id, updatedAt: now })
      const moved = await db.orderItems.get(itemId)
      if (moved) await enqueueSync('orderItems', itemId, moved)
    }
    await recalcOrderTotals(original.id)
    await recalcOrderTotals(newOrder.id)
    const refreshed = await db.orders.get(newOrder.id)
    return refreshed ?? newOrder
  })
}

/** Menggabungkan tagihan pesanan `sourceOrderId` ke dalam `targetOrderId`. */
export async function mergeOrders(targetOrderId: string, sourceOrderId: string, actor?: { userId: string; userName: string }): Promise<void> {
  await db.transaction('rw', [db.orders, db.orderItems, db.cafeTables, db.syncQueue, db.settings, db.customers, db.auditLogs], async () => {
    const target = await db.orders.get(targetOrderId)
    const items = await db.orderItems.where('orderId').equals(sourceOrderId).toArray()
    for (const item of items) {
      await db.orderItems.update(item.id, { orderId: targetOrderId, updatedAt: getTrustedNow() })
      const moved = await db.orderItems.get(item.id)
      if (moved) await enqueueSync('orderItems', item.id, moved)
    }
    const source = await db.orders.get(sourceOrderId)
    await db.orders.update(sourceOrderId, {
      status: 'void',
      voidReason: `Digabung ke pesanan ${target?.orderNumber ?? targetOrderId}`,
      voidedAt: getTrustedNow(),
      updatedAt: getTrustedNow(),
    })
    const updatedSource = await db.orders.get(sourceOrderId)
    if (updatedSource) await enqueueSync('orders', sourceOrderId, updatedSource)

    if (source?.tableId) {
      const table = await db.cafeTables.get(source.tableId)
      if (table && table.currentOrderId === sourceOrderId) {
        await db.cafeTables.update(source.tableId, {
          status: 'available',
          currentOrderId: null,
          occupiedSince: null,
          guestCount: null,
          updatedAt: getTrustedNow(),
        })
      }
    }
    await recalcOrderTotals(targetOrderId)
    if (actor && source && target) {
      await recordAuditLog({
        userId: actor.userId,
        userName: actor.userName,
        action: 'order.merge',
        entityType: 'order',
        entityId: targetOrderId,
        details: `Tagihan ${source.orderNumber} (${items.length} item) digabung ke ${target.orderNumber}.`,
      })
    }
  })
}
