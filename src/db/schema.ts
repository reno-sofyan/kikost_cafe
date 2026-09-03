import Dexie, { type Table } from 'dexie'
import type {
  AuditLogEntry,
  Bill,
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
  Printer,
  PrintJob,
  PrintRoute,
  Product,
  Purchase,
  Recipe,
  ReturnRecord,
  Shift,
  StockMovement,
  StockOpname,
  SyncQueueEntry,
  TableCall,
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
  purchases!: Table<Purchase, string>
  stockOpnames!: Table<StockOpname, string>
  cafeTables!: Table<CafeTable, string>
  customers!: Table<Customer, string>
  orders!: Table<Order, string>
  orderItems!: Table<OrderItem, string>
  kitchenTickets!: Table<KitchenTicket, string>
  bills!: Table<Bill, string>
  payments!: Table<Payment, string>
  printers!: Table<Printer, string>
  printRoutes!: Table<PrintRoute, string>
  printJobs!: Table<PrintJob, string>
  tableCalls!: Table<TableCall, string>
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

    // v4 (Fase 2a): pembelian/penerimaan barang, stok opname, referensi dokumen
    // pada pergerakan stok. Aditif.
    this.version(4)
      .stores({
        purchases: 'id, status, supplierName, createdAt',
        stockOpnames: 'id, status, createdAt',
        stockMovements: 'id, itemType, itemId, createdAt, reason, refType',
      })
      .upgrade(async (tx) => {
        await tx
          .table('stockMovements')
          .toCollection()
          .modify((m: StockMovement) => {
            m.refType = m.refType ?? (m.refOrderId ? 'order' : null)
            m.refId = m.refId ?? m.refOrderId ?? null
          })
      })

    // v5 (Fase 2b): entitas Bill terpisah dari Order + pembayaran sebagian.
    this.version(5)
      .stores({
        bills: 'id, orderId, paymentStatus, createdAt',
        payments: 'id, orderId, billId, idempotencyKey, method, createdAt',
      })
      .upgrade(async (tx) => {
        const settings = await tx.table('settings').get('singleton')
        if (settings) {
          await tx.table('settings').put({ ...settings, allowPartialPayment: settings.allowPartialPayment ?? false })
        }

        // Backfill bill implisit + billId pembayaran untuk order yang sudah terbayar/void.
        const orders: Order[] = await tx.table('orders').toArray()
        const allPayments: Payment[] = await tx.table('payments').toArray()
        const paymentsByOrder = new Map<string, Payment[]>()
        for (const p of allPayments) {
          const list = paymentsByOrder.get(p.orderId) ?? []
          list.push(p)
          paymentsByOrder.set(p.orderId, list)
        }

        for (const o of orders) {
          if (!['paid', 'void', 'completed'].includes(o.status)) continue
          const billId = `bill_${o.id}`
          const ps = paymentsByOrder.get(o.id) ?? []
          const paid = ps.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0)
          const refunded = ps.filter((p) => p.amount < 0).reduce((s, p) => s + Math.abs(p.amount), 0)
          const status =
            o.status === 'void' ? 'VOIDED' : refunded >= o.grandTotal && refunded > 0 ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : 'PAID'
          const existing = await tx.table('bills').get(billId)
          if (!existing) {
            await tx.table('bills').put({
              id: billId,
              orderId: o.id,
              label: 'Tagihan',
              itemIds: 'all',
              portionAmount: null,
              subtotal: o.subtotal,
              discountAmount: o.discountAmount,
              serviceChargeAmount: o.serviceChargeAmount,
              taxAmount: o.taxAmount,
              roundingAdjustment: o.roundingAdjustment,
              grandTotal: o.grandTotal,
              amountPaid: paid,
              amountRefunded: refunded,
              paymentStatus: status,
              createdAt: o.createdAt,
              updatedAt: o.updatedAt,
            })
          }
        }

        await tx
          .table('payments')
          .toCollection()
          .modify((p: Payment) => {
            p.billId = p.billId ?? `bill_${p.orderId}`
          })
      })

    // v6 (Fitur B: printer multi-station): printer, routing, antrean cetak.
    // Fitur A (QR) sebagian: order.source + kitchenTicket.station.
    this.version(6)
      .stores({
        printers: 'id, station, active',
        printRoutes: 'id, categoryId, station',
        printJobs: 'id, status, kind, station, orderId, createdAt',
        kitchenTickets: 'id, orderId, station, sequenceNo, createdAt',
      })
      .upgrade(async (tx) => {
        const settings = await tx.table('settings').get('singleton')
        const pc = settings?.printerConfig
        if (pc && pc.connectionType && pc.connectionType !== 'none' && pc.connectionType !== 'browser') {
          const existing = await tx.table('printers').count()
          if (existing === 0) {
            const now = Date.now()
            await tx.table('printers').add({
              id: 'printer_cashier_default',
              name: 'Printer Kasir',
              station: 'cashier',
              connectionType: pc.connectionType,
              bluetoothAddress: pc.bluetoothAddress ?? null,
              bluetoothName: pc.bluetoothName ?? null,
              networkHost: pc.networkHost ?? null,
              networkPort: pc.networkPort ?? 9100,
              paperSize: pc.paperSize ?? settings?.receiptPaperSize ?? '58mm',
              active: true,
              fallbackPrinterId: null,
              createdAt: now,
              updatedAt: now,
            })
          }
        }
        await tx
          .table('kitchenTickets')
          .toCollection()
          .modify((t: KitchenTicket & { station: string }) => {
            if (!t.station || t.station === 'all') t.station = 'kitchen'
          })
        await tx
          .table('orders')
          .toCollection()
          .modify((o: Order & { source?: string }) => {
            o.source = o.source ?? (o.type === 'takeaway' ? 'takeaway' : o.type === 'delivery' ? 'delivery' : 'cashier')
          })
        await tx
          .table('orderItems')
          .toCollection()
          .modify((it: OrderItem & { kitchenPrintedAt?: number | null }) => {
            it.kitchenPrintedAt = it.kitchenPrintedAt ?? (it.kitchenStatus !== 'new' ? it.createdAt : null)
          })
      })

    // v7 (Fitur A: pemesanan mandiri via QR meja): token QR per meja, permintaan
    // pelanggan (panggil waiter / minta tagihan), lifecycle PENDING_CONFIRMATION/REJECTED.
    // Aditif — kolom baru opsional, store baru, indeks baru.
    this.version(7)
      .stores({
        cafeTables: 'id, status, area, name, qrToken',
        tableCalls: 'id, tableId, type, status, createdAt',
      })
      .upgrade(async (tx) => {
        const settings = await tx.table('settings').get('singleton')
        if (settings) {
          await tx.table('settings').put({
            ...settings,
            qrOrderBaseUrl: settings.qrOrderBaseUrl ?? 'https://pos.kikost.com',
          })
        }
        await tx
          .table('cafeTables')
          .toCollection()
          .modify((t: CafeTable) => {
            t.qrToken = t.qrToken ?? null
            t.qrActive = t.qrActive ?? false
          })
        await tx
          .table('orders')
          .toCollection()
          .modify((o: Order & { rejectedReason?: string | null }) => {
            o.rejectedReason = o.rejectedReason ?? null
          })
      })
  }
}

export const db = new KikostDatabase()
