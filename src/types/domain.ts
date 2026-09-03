// Tipe domain inti aplikasi Kikost Cafe POS.
// Semua entitas memakai UUID sebagai id agar aman untuk sinkronisasi offline-first.

export type Role = 'administrator' | 'supervisor' | 'kasir' | 'dapur'

export type Permission =
  | 'discount.apply'
  | 'price.override'
  | 'order.void'
  | 'order.return'
  | 'refund.restock'
  | 'stock.adjust'
  | 'reports.view'
  | 'settings.manage'
  | 'users.manage'
  | 'shift.manage'
  | 'cash.variance.approve'

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
  /** Blind closing: sembunyikan "kas seharusnya" sampai kasir mengisi hitungan fisik. */
  blindClose: boolean
  /** Selisih kas absolut di atas nilai ini butuh persetujuan supervisor saat tutup shift. */
  cashVarianceTolerance: number
  /** Izinkan pembayaran sebagian (bill jadi PARTIALLY_PAID, order belum selesai). */
  allowPartialPayment: boolean
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
  /** Satuan qty ini. Bila kosong, diasumsikan satuan dasar bahan. Boleh beda
   *  satuan sekeluarga (mis. resep "0.018 kg" untuk bahan ber-satuan g). */
  unit?: UnitOfMeasure
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
  // Fase 2 — jenis lengkap (nilai lama tetap valid):
  | 'purchase_receipt'
  | 'transfer_in'
  | 'transfer_out'
  | 'stock_opname'
  | 'production_consumption'
  | 'production_output'

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
  /** Dokumen sumber non-order: 'purchase' | 'opname' | 'transfer' | 'production'. */
  refType: string | null
  refId: string | null
  createdAt: number
}

export type PurchaseStatus = 'draft' | 'received'

export interface PurchaseLine {
  itemType: StockMovementItemType
  itemId: string
  itemName: string
  qty: number
  unit: UnitOfMeasure
  unitCost: number
  lineCost: number
}

/** Pembelian & penerimaan barang dari pemasok. Menerima = memposting stok. */
export interface Purchase {
  id: string
  supplierName: string
  invoiceNo: string
  lines: PurchaseLine[]
  totalCost: number
  status: PurchaseStatus
  note: string
  createdBy: string
  receivedBy: string | null
  receivedAt: number | null
  createdAt: number
  updatedAt: number
}

export type StockOpnameStatus = 'draft' | 'finalized'

export interface OpnameLine {
  itemType: StockMovementItemType
  itemId: string
  itemName: string
  systemQty: number
  countedQty: number | null
  unit: UnitOfMeasure
}

/** Stok opname: hitung fisik → selisih diposting sebagai adjustment beralasan. */
export interface StockOpname {
  id: string
  lines: OpnameLine[]
  status: StockOpnameStatus
  note: string
  createdBy: string
  finalizedBy: string | null
  finalizedAt: number | null
  createdAt: number
  updatedAt: number
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

/**
 * Status legacy — menggerakkan proteksi pembayaran, proteksi sync "final", dan
 * laporan lama. Dipertahankan untuk kompatibilitas; UI/KDS memakai lifecycleStatus.
 */
export type OrderStatus = 'open' | 'paid' | 'void' | 'completed'

/**
 * Siklus hidup order gaya POS matang. Transisi divalidasi oleh lib/orderState.ts.
 *   DRAFT → CONFIRMED → PREPARING → READY → SERVED → COMPLETED
 *   + CANCELLED (batal sebelum konfirmasi) / VOIDED (dibatalkan setelah konfirmasi)
 */
export type OrderLifecycleStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'VOIDED'

export type KitchenItemStatus = 'new' | 'in_progress' | 'ready' | 'done'

export interface KitchenTicket {
  id: string
  orderId: string
  /** Nomor urut tiket per order — tiket ke-2+ = pesanan tambahan setelah tiket pertama. */
  sequenceNo: number
  /** Station tujuan (mis. "kitchen", "bar"). Kafe kecil: "all". */
  station: string
  itemIds: string[]
  printedAt: number | null
  createdAt: number
  updatedAt: number
}

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
  /** Soft-delete: item dihapus sebelum dikirim ke dapur (menggantikan hard delete). */
  removed: boolean
  ticketId: string | null
  queuedAt: number | null
  startedAt: number | null
  readyAt: number | null
  servedAt: number | null
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
  /** Siklus hidup gaya POS matang. Backfill dari `status` pada migrasi v3. */
  lifecycleStatus: OrderLifecycleStatus
  subtotal: number
  discountType: DiscountType | null
  discountValue: number
  discountAmount: number
  taxPercent: number
  taxAmount: number
  serviceChargePercent: number
  serviceChargeAmount: number
  /** Snapshot pembulatan saat order dibuat — agar setelan yang berubah tak menggeser total lama. */
  roundingIncrementSnapshot: number
  roundingAdjustment: number
  grandTotal: number
  shiftId: string | null
  /** Perangkat pembuat — untuk penomoran & antrean aman-offline dan atribusi shift. */
  deviceId: string
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

export type BillPaymentStatus =
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'VOIDED'

/**
 * Tagihan — entitas pembayaran yang terpisah dari Order. Satu order → 1..n bill
 * (default 1 bill meliputi seluruh order; bisa dipecah per item / nominal).
 * Total bill di-snapshot; pembayaran & refund direferensikan lewat billId.
 */
export interface Bill {
  id: string
  orderId: string
  label: string
  /** 'all' = seluruh item order; array = subset item; null + portionAmount = potongan nominal. */
  itemIds: string[] | 'all'
  portionAmount: number | null
  subtotal: number
  discountAmount: number
  serviceChargeAmount: number
  taxAmount: number
  roundingAdjustment: number
  grandTotal: number
  amountPaid: number
  amountRefunded: number
  paymentStatus: BillPaymentStatus
  createdAt: number
  updatedAt: number
}

export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'card'

export interface PaymentInput {
  method: PaymentMethod
  amount: number
  receivedAmount?: number
  reference?: string
}

export interface Payment {
  id: string
  orderId: string
  /** Bill yang dibayar. Untuk data lama / order tanpa split = bill implisit order. */
  billId: string
  method: PaymentMethod
  /** Positif = pembayaran, negatif = pengembalian/refund. */
  amount: number
  receivedAmount: number | null
  changeAmount: number | null
  reference: string | null
  /**
   * Kunci idempotensi bisnis — deterministik dari (orderId, method, amount, urutan).
   * Dua perangkat yang memproses pembayaran yang sama menghasilkan id yang sama → LWW dedup.
   */
  idempotencyKey: string
  /** Diisi bila pembayaran ini adalah pembalik (refund) dari pembayaran lain. */
  reversalOfPaymentId: string | null
  confirmedByUserId: string
  createdAt: number
}

export type ShiftStatus = 'open' | 'closed'

export interface Shift {
  id: string
  /** Perangkat pemilik shift — satu perangkat maksimum satu shift `open`. */
  deviceId: string
  cashierId: string
  cashierName: string
  openingCash: number
  expectedCash: number
  closingCashActual: number | null
  variance: number | null
  /** Diisi bila selisih melewati toleransi dan disetujui supervisor. */
  varianceApprovedBy: string | null
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
  /** Pembayaran pembalik (amount negatif) yang dibuat untuk retur ini. */
  reversalPaymentId: string | null
  userId: string
  approverName: string
  createdAt: number
}

export type SyncEntity =
  | 'orders'
  | 'orderItems'
  | 'kitchenTickets'
  | 'payments'
  | 'shifts'
  | 'cashMovements'
  | 'expenses'
  | 'returns'
  | 'stockMovements'
  | 'purchases'
  | 'stockOpnames'
  | 'bills'
  | 'products'
  | 'ingredients'
  | 'recipes'
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
