import Dexie, { type Table } from 'dexie'
import type {
  AuditLogEntry,
  CafeSettings,
  CafeTable,
  CashMovement,
  Category,
  Customer,
  Expense,
  Ingredient,
  KitchenTicket,
  ModifierGroup,
  ModifierOption,
  Order,
  OrderItem,
  OrderLifecycleStatus,
  Payment,
  Product,
  Recipe,
  ReturnRecord,
  Shift,
  StockMovement,
  SyncQueueEntry,
  User,
} from '@/types/domain'

/** Peta status legacy → siklus hidup, dipakai saat migrasi v3 backfill. */
function lifecycleFromLegacy(status: string, hasKitchenActivity: boolean): OrderLifecycleStatus {
  if (status === 'paid' || status === 'completed') return 'COMPLETED'
  if (status === 'void') return 'VOIDED'
  return hasKitchenActivity ? 'CONFIRMED' : 'DRAFT'
}

export class KikostDatabase extends Dexie {
  settings!: Table<CafeSettings, string>
  users!: Table<User, string>
  auditLogs!: Table<AuditLogEntry, string>
  categories!: Table<Category, string>
  products!: Table<Product, string>
  ingredients!: Table<Ingredient, string>
  recipes!: Table<Recipe, string>
  modifierGroups!: Table<ModifierGroup, string>
  modifierOptions!: Table<ModifierOption, string>
  stockMovements!: Table<StockMovement, string>
  cafeTables!: Table<CafeTable, string>
  customers!: Table<Customer, string>
  orders!: Table<Order, string>
  orderItems!: Table<OrderItem, string>
  kitchenTickets!: Table<KitchenTicket, string>
  payments!: Table<Payment, string>
  shifts!: Table<Shift, string>
  cashMovements!: Table<CashMovement, string>
  expenses!: Table<Expense, string>
  returns!: Table<ReturnRecord, string>
  syncQueue!: Table<SyncQueueEntry, string>

  constructor() {
    super('kikost-cafe-pos')

    this.version(1).stores({
      settings: 'id',
      users: 'id, role, active',
      auditLogs: 'id, userId, createdAt, entityType',
      categories: 'id, sortOrder, active',
      products: 'id, categoryId, sku, barcode, isAvailable, isFavorite, name',
      ingredients: 'id, name',
      recipes: 'id, productId',
      modifierGroups: 'id, type, sortOrder',
      modifierOptions: 'id, groupId, sortOrder',
      stockMovements: 'id, itemType, itemId, createdAt, reason',
      cafeTables: 'id, status, area',
      customers: 'id, name, phone',
      orders: 'id, orderNumber, status, type, tableId, shiftId, cashierId, createdAt, idempotencyKey',
      orderItems: 'id, orderId, productId, kitchenStatus, createdAt',
      payments: 'id, orderId, method, createdAt',
      shifts: 'id, cashierId, status, openedAt',
      cashMovements: 'id, shiftId, type, createdAt',
      expenses: 'id, shiftId, category, createdAt',
      returns: 'id, orderId, createdAt',
      syncQueue: 'id, entity, entityId, status, createdAt',
    })

    // v2: indeks `name` untuk cafeTables & users — dipakai `orderBy('name')`
    // pada layar Meja dan Manajemen Pengguna (tanpa indeks -> Dexie SchemaError).
    this.version(2).stores({
      users: 'id, role, active, name',
      cafeTables: 'id, status, area, name',
    })

    // v3 (Fase 1 audit kematangan POS): siklus hidup order, soft-delete item,
    // kitchen ticket + timestamp, idempotency pembayaran, shift per-perangkat.
    // Semua ADITIF — kolom baru opsional, store baru, indeks baru. Backfill di upgrade().
    this.version(3)
      .stores({
        orders:
          'id, orderNumber, status, lifecycleStatus, type, tableId, shiftId, deviceId, cashierId, createdAt, idempotencyKey',
        orderItems: 'id, orderId, productId, kitchenStatus, ticketId, removed, createdAt, [orderId+removed]',
        kitchenTickets: 'id, orderId, station, sequenceNo, createdAt',
        payments: 'id, orderId, idempotencyKey, method, createdAt',
        shifts: 'id, cashierId, deviceId, status, openedAt, [deviceId+status]',
        auditLogs: 'id, userId, createdAt, entityType, action',
      })
      .upgrade(async (tx) => {
        const settings = await tx.table('settings').get('singleton')
        const rounding = settings?.roundingIncrement ?? 100
        if (settings) {
          await tx.table('settings').put({
            ...settings,
            blindClose: settings.blindClose ?? false,
            cashVarianceTolerance: settings.cashVarianceTolerance ?? 5000,
          })
        }

        const items: OrderItem[] = await tx.table('orderItems').toArray()
        const kitchenByOrder = new Map<string, boolean>()
        for (const it of items) {
          if (it.kitchenStatus && it.kitchenStatus !== 'new') kitchenByOrder.set(it.orderId, true)
        }

        await tx
          .table('orders')
          .toCollection()
          .modify((o: Order) => {
            o.lifecycleStatus = o.lifecycleStatus ?? lifecycleFromLegacy(o.status, kitchenByOrder.get(o.id) ?? false)
            o.roundingIncrementSnapshot = o.roundingIncrementSnapshot ?? rounding
            o.deviceId = o.deviceId ?? 'legacy'
          })

        await tx
          .table('orderItems')
          .toCollection()
          .modify((it: OrderItem) => {
            it.removed = it.removed ?? false
            it.ticketId = it.ticketId ?? null
            it.queuedAt = it.queuedAt ?? (it.kitchenStatus !== 'new' ? it.createdAt : null)
            it.startedAt = it.startedAt ?? null
            it.readyAt = it.readyAt ?? null
            it.servedAt = it.servedAt ?? (it.kitchenStatus === 'done' ? it.updatedAt : null)
          })

        await tx
          .table('payments')
          .toCollection()
          .modify((p: Payment) => {
            p.idempotencyKey = p.idempotencyKey ?? `legacy:${p.orderId}:${p.method}:${p.amount}:${p.id.slice(0, 8)}`
            p.reversalOfPaymentId = p.reversalOfPaymentId ?? null
          })

        await tx
          .table('shifts')
          .toCollection()
          .modify((s: Shift) => {
            s.deviceId = s.deviceId ?? 'legacy'
            s.varianceApprovedBy = s.varianceApprovedBy ?? null
          })

        await tx
          .table('returns')
          .toCollection()
          .modify((r: ReturnRecord) => {
            r.reversalPaymentId = r.reversalPaymentId ?? null
            r.approverName = r.approverName ?? ''
          })
      })
  }
}

export const db = new KikostDatabase()
