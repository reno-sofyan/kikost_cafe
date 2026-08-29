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
  ModifierGroup,
  ModifierOption,
  Order,
  OrderItem,
  Payment,
  Product,
  Recipe,
  ReturnRecord,
  Shift,
  StockMovement,
  SyncQueueEntry,
  User,
} from '@/types/domain'

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
  }
}

export const db = new KikostDatabase()
