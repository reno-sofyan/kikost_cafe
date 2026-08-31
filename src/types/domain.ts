// Tipe domain inti aplikasi Kikost Cafe POS.
// Semua entitas memakai UUID sebagai id agar aman untuk sinkronisasi offline-first.

export type Role = 'administrator' | 'supervisor' | 'kasir' | 'dapur'

export type Permission =
  | 'discount.apply'
  | 'price.override'
  | 'order.void'
  | 'order.return'
  | 'stock.adjust'
  | 'reports.view'
  | 'settings.manage'
  | 'users.manage'
  | 'shift.manage'

export interface User {
  id: string
  name: string
  role: Role
  pinHash: string
  pinSalt: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface AuditLogEntry {
  id: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  details: string
  createdAt: number
}

export type ReceiptPaperSize = '58mm' | '80mm'

export interface CafeSettings {
  id: 'singleton'
  onboardingCompleted: boolean
  cafeName: string
  logoDataUrl: string | null
  address: string
  phone: string
  taxPercent: number
  serviceChargePercent: number
  roundingIncrement: number
  transactionPrefix: string
  nextTransactionSequence: number
  qrisImageDataUrl: string | null
  qrisMerchantName: string | null
  receiptPaperSize: ReceiptPaperSize
  receiptFooterNote: string
  autoLockMinutes: number
  printerConfig: PrinterConfig
  currency: 'IDR'
  timezone: 'Asia/Jakarta'
  updatedAt: number
}

export type PrinterConnectionType = 'none' | 'bluetooth' | 'network' | 'browser'

export interface PrinterConfig {
  connectionType: PrinterConnectionType
  paperSize: ReceiptPaperSize
  bluetoothAddress: string | null
  bluetoothName: string | null
  networkHost: string | null
  networkPort: number | null
  autoPrintOnPayment: boolean
  autoPrintKitchenOrder: boolean
}

export type UnitOfMeasure = 'pcs' | 'g' | 'kg' | 'ml' | 'l'

export interface Category {
  id: string
  name: string
  sortOrder: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface Product {
  id: string
  categoryId: string
  name: string
  sku: string
  barcode: string | null
  price: number
  costPrice: number
  unit: UnitOfMeasure
  photoDataUrl: string | null
  trackOwnStock: boolean
  stockQty: number
  lowStockThreshold: number
  isFavorite: boolean
  isAvailable: boolean
  modifierGroupIds: string[]
  createdAt: number
  updatedAt: number
}

export interface Ingredient {
  id: string
  name: string
  unit: UnitOfMeasure
  stockQty: number
  lowStockThreshold: number
  costPerUnit: number
  createdAt: number
  updatedAt: number
}

export interface RecipeItem {
  ingredientId: string
  qty: number
}

export interface Recipe {
  id: string
  productId: string
  items: RecipeItem[]
  updatedAt: number
}

export type ModifierGroupType = 'size' | 'sugar' | 'ice' | 'topping' | 'spice' | 'note'

export interface ModifierGroup {
  id: string
  name: string
  type: ModifierGroupType
  required: boolean
  multiSelect: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface ModifierOption {
  id: string
  groupId: string
  name: string
  priceDelta: number
  sortOrder: number
}

export type StockMovementItemType = 'product' | 'ingredient'
export type StockMovementReason =
  | 'sale'
  | 'return'
  | 'adjustment'
  | 'waste'
  | 'stock_in'
  | 'stock_out'
  | 'initial'

export interface StockMovement {
  id: string
  itemType: StockMovementItemType
  itemId: string
  itemName: string
  reason: StockMovementReason
  qtyDelta: number
  resultingQty: number
  note: string
  userId: string
  refOrderId: string | null
  createdAt: number
}

export type TableStatus = 'available' | 'occupied' | 'awaiting_payment' | 'needs_cleaning'

export interface CafeTable {
  id: string
  name: string
  area: string
  capacity: number
  status: TableStatus
  currentOrderId: string | null
  occupiedSince: number | null
  guestCount: number | null
  updatedAt: number
}

export interface Customer {
  id: string
  name: string
  phone: string
  note: string
  createdAt: number
  updatedAt: number
}

export type OrderType = 'dine_in' | 'takeaway' | 'delivery'
export type OrderStatus = 'open' | 'paid' | 'void' | 'completed'
export type KitchenItemStatus = 'new' | 'in_progress' | 'ready' | 'done'

export interface OrderItemModifierSnapshot {
  groupId: string
  groupName: string
  optionId: string
  optionName: string
  priceDelta: number
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  productName: string
  unitPrice: number
  qty: number
  modifiers: OrderItemModifierSnapshot[]
  notes: string
  discountAmount: number
  lineTotal: number
  kitchenStatus: KitchenItemStatus
  voided: boolean
  voidReason: string | null
  createdAt: number
  updatedAt: number
}

export type DiscountType = 'percent' | 'amount'

export interface Order {
  id: string
  orderNumber: string
  type: OrderType
  tableId: string | null
  customerId: string | null
  queueNumber: number | null
  guestCount: number | null
  status: OrderStatus
  subtotal: number
  discountType: DiscountType | null
  discountValue: number
  discountAmount: number
  taxPercent: number
  taxAmount: number
  serviceChargePercent: number
  serviceChargeAmount: number
  roundingAdjustment: number
  grandTotal: number
  shiftId: string | null
  cashierId: string
  cashierName: string
  notes: string
  idempotencyKey: string
  parentOrderId: string | null
  voidReason: string | null
  voidedBy: string | null
  voidedAt: number | null
  createdAt: number
  updatedAt: number
  paidAt: number | null
}

export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'card'

export interface Payment {
  id: string
  orderId: string
  method: PaymentMethod
  amount: number
  receivedAmount: number | null
  changeAmount: number | null
  reference: string | null
  confirmedByUserId: string
  createdAt: number
}

export type ShiftStatus = 'open' | 'closed'

export interface Shift {
  id: string
  cashierId: string
  cashierName: string
  openingCash: number
  expectedCash: number
  closingCashActual: number | null
  variance: number | null
  status: ShiftStatus
  openedAt: number
  closedAt: number | null
  notes: string
}

export type CashMovementType = 'in' | 'out'

export interface CashMovement {
  id: string
  shiftId: string
  type: CashMovementType
  amount: number
  reason: string
  userId: string
  createdAt: number
}

export interface Expense {
  id: string
  category: string
  amount: number
  note: string
  photoDataUrl: string | null
  shiftId: string | null
  userId: string
  createdAt: number
}

export interface ReturnRecord {
  id: string
  orderId: string
  orderItemIds: string[]
  reason: string
  refundAmount: number
  restocked: boolean
  userId: string
  createdAt: number
}

export type SyncEntity =
  | 'orders'
  | 'orderItems'
  | 'payments'
  | 'shifts'
  | 'cashMovements'
  | 'expenses'
  | 'returns'
  | 'stockMovements'
  | 'products'
  | 'ingredients'
  | 'categories'
  | 'customers'
  | 'auditLogs'

export type SyncOperation = 'upsert'
export type SyncQueueStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export interface SyncQueueEntry {
  id: string
  entity: SyncEntity
  entityId: string
  operation: SyncOperation
  payload: unknown
  idempotencyKey: string
  status: SyncQueueStatus
  attempts: number
  lastError: string | null
  createdAt: number
  updatedAt: number
}
