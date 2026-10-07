// Tipe domain inti aplikasi Kione POS.
// Semua entitas memakai UUID sebagai id agar aman untuk sinkronisasi offline-first.

export type Role = 'pemilik' | 'administrator' | 'supervisor' | 'kasir' | 'pramusaji' | 'dapur'

export type Permission =
  | 'discount.apply'
  | 'price.override'
  | 'order.void'
  | 'order.return'
  | 'refund.restock'
  | 'stock.adjust'
  | 'stock.delete'
  | 'reports.view'
  | 'settings.manage'
  | 'users.manage'
  | 'shift.manage'
  | 'cash.variance.approve'
  | 'printer.manage'
  | 'print.retry'
  | 'receipt.reprint'
  | 'kitchen.ticket.cancel'
  | 'qr.manage'
  | 'qr.order.confirm'
  | 'tablesession.manage'

/**
 * Outlet / cabang. Kafe satu-lokasi memakai satu outlet default; struktur ini
 * memungkinkan pemisahan laporan & stok per cabang tanpa perubahan besar nanti.
 */
export interface Outlet {
  id: string
  name: string
  address: string
  phone: string
  timezone: string
  active: boolean
  createdAt: number
  updatedAt: number
}

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
  /**
   * Rantai hash untuk mendeteksi (bukan mencegah) entri yang diubah/dihapus
   * lewat akses langsung ke IndexedDB, di luar aplikasi ini — lihat
   * `src/lib/auditLogIntegrity.ts`. Di-scope PER PERANGKAT (`deviceId`), bukan
   * global: tablet offline-first menulis entrinya sendiri sebelum sempat
   * sinkron, jadi tidak ada urutan tunggal lintas-perangkat yang pasti.
   * `null` di ketiganya = entri lama, dibuat sebelum fitur ini ada — tetap
   * tersimpan apa adanya, ditandai "tak bisa diverifikasi" saat dicek.
   */
  deviceId: string | null
  /** Nomor urut menaik PER PERANGKAT (bukan `createdAt`) — beberapa entri bisa
   *  punya `createdAt` identik (resolusi milidetik), jadi urutan penulisan yang
   *  benar-benar bisa diandalkan untuk verifikasi rantai adalah nomor ini, bukan
   *  waktunya. `null` = entri lama, dibuat sebelum fitur ini ada. */
  deviceSeq: number | null
  prevHash: string | null
  hash: string | null
}

export type ReceiptPaperSize = '58mm' | '80mm'

/**
 * Jenis usaha — menentukan fitur mana yang relevan ditampilkan (Meja, Dapur,
 * Pesanan QR, Pager). Lihat `src/lib/businessType.ts` untuk pemetaan lengkapnya.
 * `lainnya` (dan nilai tak dikenal apa pun) SENGAJA menampilkan semua fitur —
 * jangan pernah menyembunyikan sesuatu untuk jenis usaha yang tidak dikenali.
 */
export type BusinessType = 'cafe_resto' | 'kantin' | 'minimarket' | 'lainnya'

export interface AppSettings {
  id: 'singleton'
  onboardingCompleted: boolean
  businessName: string
  businessType: BusinessType
  /** Reset antrean manual (Pengaturan → Antrean): nomor berikutnya mulai dari 1
   *  lagi, hanya memperhitungkan nomor yang diberikan setelah waktu ini. */
  queueResetAt?: number | null
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
  /** Basis URL publik halaman pesan-mandiri (mis. https://pesan.usahaanda.com). Kosong = pakai origin perangkat. QR berisi `<base>/order/<token>`. */
  qrOrderBaseUrl: string
  /** Outlet aktif di perangkat ini (Fase 3). */
  activeOutletId?: string
  receiptPaperSize: ReceiptPaperSize
  receiptFooterNote: string
  autoLockMinutes: number
  printerConfig: PrinterConfig
  pagerConfig: PagerConfig
  currency: 'IDR'
  timezone: 'Asia/Jakarta'
  updatedAt: number
}

export type PrinterConnectionType = 'none' | 'bluetooth' | 'network' | 'browser'

/** Subset dipakai driver ESC/POS — dipenuhi baik `PrinterConfig` (lawas, satu global)
 *  maupun `Printer` (multi-station), supaya kode pengiriman tak perlu tahu sumbernya. */
export interface PrinterConnectionSettings {
  connectionType: PrinterConnectionType
  bluetoothAddress: string | null
  networkHost: string | null
  networkPort: number | null
}

export interface PrinterConfig extends PrinterConnectionSettings {
  paperSize: ReceiptPaperSize
  bluetoothName: string | null
  autoPrintOnPayment: boolean
  autoPrintKitchenOrder: boolean
}

// ---- Integrasi pager restoran (Wireless Calling System) ----

/**
 * - `usb-serial`: base station dengan antarmuka PC call (Retekess TD112/TD159/dst.)
 *   dicolok via USB-OTG — aplikasi mengirim perintah panggil otomatis.
 * - `manual`: base station keypad-only tanpa antarmuka software (mis. Retekess
 *   TD157, **iWare Q10M**, dan kebanyakan "wireless calling system" murah di
 *   marketplace) — aplikasi TIDAK bisa mengirim perintah apa pun ke perangkat
 *   ini. Ia hanya menetapkan & menampilkan nomor coaster di Layar Dapur; staf
 *   memencet nomor itu sendiri di keypad transmitter.
 */
export type PagerConnectionType = 'none' | 'usb-serial' | 'manual'

/**
 * Setelan jembatan ke base station pager restoran yang dicolok ke tablet lewat
 * USB-OTG (butuh kabel USB-to-RS232 FTDI/CP2102/CH340/PL2303 untuk model DB9),
 * ATAU mode manual untuk base station keypad-only tanpa kabel sama sekali.
 * Nomor coaster (`Order.pagerNumber`) didaur ulang dari kumpulan 1..maxPagerNumber
 * saat order siap, jadi terpisah dari nomor antrean harian yang terus naik.
 */
export interface PagerConfig {
  connectionType: PagerConnectionType
  /** Bunyikan pager otomatis begitu semua item order berstatus siap (lifecycle READY). */
  autoCallOnReady: boolean
  /** Baud rate port serial base station. Umumnya 9600. */
  baudRate: number
  /**
   * Template frame yang dikirim ke base station. Karakter dianggap hex; token
   * `{n}` / `{nn}` / `{nnn}` / `{nnnn}` diganti digit ASCII nomor pager
   * (zero-pad sesuai panjang token). Kosong = belum dikonfigurasi.
   * Contoh: `"AA{nnn}55"` untuk pager 12 → byte `AA 30 31 32 55`.
   */
  commandTemplateHex: string
  /** Nomor pager tertinggi yang valid (= jumlah coaster fisik). */
  maxPagerNumber: number
  /** Jeda antar byte saat menulis ke port (ms). Kebanyakan base station: 0. */
  interCharDelayMs: number
  /** USB deviceId terakhir yang dipilih (opsional; kosong = pakai device pertama yang dikenali). */
  usbDeviceId: number | null
  usbDeviceLabel: string | null
}

// ---- Printer multi-station (Fitur B) ----

export type PrinterStation = 'cashier' | 'kitchen' | 'bar'

export const PRINTER_STATIONS: PrinterStation[] = ['cashier', 'kitchen', 'bar']

/**
 * Tujuan item sebuah kategori: station printer, ATAU `direct` = barang siap jual
 * (minuman botol, es krim, kerupuk) yang langsung diserahkan kasir — tidak masuk
 * Layar Dapur, tidak dicetak sebagai tiket, dan tidak menahan status pesanan.
 */
export type RouteStation = PrinterStation | 'direct'

export const ROUTE_STATIONS: RouteStation[] = ['kitchen', 'bar', 'cashier', 'direct']

export interface Printer {
  id: string
  name: string
  station: PrinterStation
  connectionType: Exclude<PrinterConnectionType, 'none'>
  bluetoothAddress: string | null
  bluetoothName: string | null
  networkHost: string | null
  networkPort: number | null
  paperSize: ReceiptPaperSize
  active: boolean
  /** Printer cadangan bila printer ini gagal. */
  fallbackPrinterId: string | null
  createdAt: number
  updatedAt: number
}

/** Pemetaan kategori menu → station. `categoryId: null` = aturan default. */
export interface PrintRoute {
  id: string
  categoryId: string | null
  station: RouteStation
  updatedAt: number
}

export type PrintJobKind = 'receipt' | 'kitchen_ticket'
export type PrintJobStatus =
  | 'QUEUED'
  | 'PRINTING'
  | 'PRINTED'
  | 'FAILED'
  | 'RETRYING'
  | 'PERMANENTLY_FAILED'

export interface PrintJob {
  id: string
  /** Kunci idempotensi bisnis — retry jaringan tak boleh mencetak dua kali. */
  idempotencyKey: string
  kind: PrintJobKind
  station: PrinterStation
  printerId: string | null
  /** ReceiptData (untuk 'receipt') atau KitchenTicketPayload (untuk 'kitchen_ticket') sebagai JSON. */
  payload: unknown
  title: string
  isReprint: boolean
  orderId: string | null
  ticketId: string | null
  requestedBy: string
  requestedByName: string
  status: PrintJobStatus
  attempts: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  printedAt: number | null
}

export interface KitchenTicketLine {
  qty: number
  name: string
  modifiers: string[]
  note: string
}

export interface KitchenTicketPayload {
  outletName: string
  orderNumber: string
  tableOrQueue: string
  customerName: string
  orderedAtLabel: string
  cashierName: string
  source: string
  ticketLabel: string
  paperSize: ReceiptPaperSize
  lines: KitchenTicketLine[]
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
  /** Diarsipkan: disembunyikan dari Kasir, menu QR, dan daftar Produk (kecuali tampilan Arsip).
   *  Dipakai alih-alih hapus permanen supaya riwayat & laporan tetap utuh. */
  archived?: boolean
  /** Deskripsi singkat — ditampilkan di halaman detail produk pesan-mandiri QR. */
  description?: string
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

export type ProductionStatus = 'draft' | 'completed'

/** Satu baris bahan yang dikonsumsi dalam sebuah produksi. */
export interface ProductionInputLine {
  itemType: StockMovementItemType
  itemId: string
  itemName: string
  qty: number
  unit: UnitOfMeasure
}

/**
 * Satu produksi/olahan: mengubah beberapa bahan input menjadi satu output
 * (bahan olahan atau produk ber-stok sendiri). Contoh: gula + air → simple syrup;
 * biji kopi → batch cold brew. Menghasilkan pergerakan stok
 * `production_consumption` (input, negatif) + `production_output` (output, positif).
 */
export interface ProductionRun {
  id: string
  outputItemType: StockMovementItemType
  outputItemId: string
  outputItemName: string
  outputQty: number
  outputUnit: UnitOfMeasure
  inputs: ProductionInputLine[]
  note: string
  status: ProductionStatus
  createdBy: string
  completedBy: string | null
  completedAt: number | null
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
  /** Token acak (bukan id meja) yang dipetakan backend → meja. null bila QR belum dibuat. */
  qrToken: string | null
  /** QR aktif? Dinonaktifkan → backend menolak (410) tanpa hapus meja. */
  qrActive: boolean
  /** Posisi bebas di kanvas denah (mode "Susun Denah"). null = belum diatur —
   *  tampil di grid otomatis sampai pengguna menggeser sekali. */
  posX: number | null
  posY: number | null
  updatedAt: number
}

/** Permintaan ringan dari pelanggan lewat halaman status QR (panggil waiter / minta tagihan). */
export interface TableCall {
  id: string
  tableId: string
  type: 'waiter' | 'bill'
  status: 'pending' | 'done'
  note: string
  createdAt: number
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
export type OrderSource = 'cashier' | 'qr_table' | 'takeaway' | 'delivery'

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
  | 'PENDING_CONFIRMATION'
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
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
  /**
   * Item kategori ber-station `direct` (barang siap jual): dibuat langsung `done`,
   * tak pernah dikirim ke dapur, dan diabaikan saat menghitung status dapur pesanan.
   * Opsional — item lama/dari server tanpa field ini = `false`.
   */
  skipKitchen?: boolean
  /** Soft-delete: item dihapus sebelum dikirim ke dapur (menggantikan hard delete). */
  removed: boolean
  /** Alasan & pelaku penghapusan item (kantin, sejak v1.0.14). Kosong = data lama. */
  removedReason?: string | null
  removedByName?: string | null
  removedAt?: number | null
  /** `owner_code` = ikut "Kosongkan" yang disetujui kode Pemilik; `reason` = hapus biasa dengan alasan. */
  removedApproval?: 'reason' | 'owner_code' | null
  /** Akumulasi nilai (Rp) yang hilang karena qty item ini dikurangi — jejak koreksi. */
  reducedValue?: number
  /** Waktu item ini dicetak ke tiket dapur/bar. Item tambahan (belum tercetak) tak
   *  memicu cetak ulang seluruh pesanan. */
  kitchenPrintedAt: number | null
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
  /** Nomor HP pelanggan — diisi server untuk pesanan pesan-mandiri via QR (lihat publicOrders.ts). */
  customerPhone?: string
  queueNumber: number | null
  /** Kapan `queueNumber` diberikan (pesanan QR baru dapat nomor saat diterima kasir,
   *  bukan saat dibuat). Dipakai reset antrean manual. Kosong = data lama → `createdAt`. */
  queueAssignedAt?: number | null
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
  /** Outlet asal pesanan (opsional; kafe satu-lokasi = outlet default). */
  outletId?: string
  /** Asal pesanan. Default 'cashier'; 'qr_table' untuk pesanan mandiri via QR. */
  source: OrderSource
  cashierId: string
  cashierName: string
  notes: string
  idempotencyKey: string
  parentOrderId: string | null
  /** Waktu (epoch ms) pager Retekess dibunyikan untuk order ini; null = belum. */
  pagerCalledAt: number | null
  /**
   * Nomor coaster pager fisik yang dipegang pelanggan, diambil dari kumpulan
   * 1..maxPagerNumber dan didaur ulang begitu order lepas dari READY. null =
   * belum dapat coaster (belum siap, pager nonaktif, atau kumpulan penuh).
   */
  pagerNumber: number | null
  /** Alasan penolakan pesanan QR oleh kasir/waiter (lifecycle REJECTED). */
  rejectedReason: string | null
  voidReason: string | null
  /** Id penyetuju pembatalan (atau kasir sendiri bila batal tanpa persetujuan). */
  voidedBy: string | null
  voidedAt: number | null
  /** Nama penyetuju pembatalan — snapshot, karena data pengguna tidak disinkronkan. */
  voidedByName?: string | null
  /** Nama pengguna yang meminta/melakukan pembatalan di kasir. */
  voidRequestedByName?: string | null
  /** Cara pembatalan disetujui. Kosong = data lama (sebelum v1.0.13). */
  voidApproval?: VoidApproval | null
  /** "Tagihan Tertunda" (kantin): pesanan internal yang dicatat sekarang, dibayar nanti.
   *  Tetap terisi setelah lunas sebagai jejak. Kosong/undefined = pesanan biasa. */
  payLater?: PayLaterInfo | null
  createdAt: number
  updatedAt: number
  paidAt: number | null
}

/** `self` = tanpa persetujuan atasan; `supervisor` = PIN supervisor/admin; `owner_code` = kode sekali pakai Pemilik. */
export type VoidApproval = 'self' | 'supervisor' | 'owner_code'

export interface PayLaterInfo {
  /** Atas nama siapa tagihan ini (mis. nama karyawan / divisi). */
  name: string
  note: string
  markedAt: number
  markedByUserId: string
  markedByName: string
  /** Shift saat tagihan tertunda dicatat — `Order.shiftId` pindah ke shift pelunasan. */
  shiftId: string | null
}

/**
 * Kode pembatalan sekali pakai yang dibuat Pemilik di tablet ini (kantin). Hanya
 * hash-nya yang disimpan, TIDAK ikut sinkronisasi maupun backup, dan hangus
 * setelah dipakai satu kali. Satu baris aktif (`id = 'active'`) per perangkat.
 */
export interface CancelCode {
  id: 'active'
  hash: string
  salt: string
  createdAt: number
  createdByUserId: string
  createdByName: string
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
  /** Referensi pembayaran online (QRIS/gateway) bila tagihan dilunasi lewat webhook. */
  onlinePaymentRef?: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Notifikasi pembayaran online dari gateway (via webhook backend). Ringan &
 * append-only — tablet-lah yang menjalankan `payBill` lokal (potong stok,
 * selesaikan order) saat menariknya, jadi kebenaran bisnis tetap di klien.
 */
/**
 * Foto bukti pembayaran (layar QRIS sukses di HP pembeli, uang tunai, dsb.) yang
 * diambil kasir SAAT membayar — wajib untuk usaha dengan fitur `paymentProof`
 * (kantin). Disimpan bersama pembayarannya dalam satu transaksi; tak bisa
 * ditambahkan belakangan. Ikut terhapus bila transaksinya dihapus admin.
 */
export interface PaymentProof {
  id: string
  orderId: string
  billId: string
  /** JPEG data URL yang sudah dikecilkan (lihat `readFileAsResizedDataUrl`).
   *  `null` = kasir memilih "Tidak bisa ambil foto" — lihat `noPhotoReason`. */
  photoDataUrl: string | null
  /** Alasan wajib bila tidak ada foto (mis. kamera rusak, pembeli sudah pergi). */
  noPhotoReason?: string | null
  takenByUserId: string
  takenByName: string
  createdAt: number
  updatedAt: number
}

export interface OnlinePayment {
  id: string
  orderId: string
  billId: string
  amount: number
  method: PaymentMethod
  reference: string
  createdAt: number
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
  /** Outlet shift ini (opsional). */
  outletId?: string
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
  /** Dokumen refund yang menyertai retur ini (Fase 2c). */
  refundId: string | null
  userId: string
  approverName: string
  createdAt: number
}

export type RefundReason = 'void' | 'return'

/**
 * Dokumen pengembalian dana — append-only, satu per pergerakan uang keluar.
 * Uangnya tetap bergerak lewat `Payment` beramount negatif (`reversalPaymentId`);
 * `Refund` adalah jejak audit/akuntansinya (alasan, metode, penyetuju, item).
 */
export interface Refund {
  id: string
  orderId: string
  billId: string
  reason: RefundReason
  amount: number
  method: PaymentMethod
  reversalPaymentId: string
  orderItemIds: string[]
  note: string
  approvedByUserId: string
  approvedByName: string
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
  | 'productions'
  | 'refunds'
  | 'onlinePayments'
  | 'paymentProofs'
  | 'bills'
  | 'printers'
  | 'printRoutes'
  | 'tableCalls'
  | 'products'
  | 'ingredients'
  | 'recipes'
  | 'categories'
  | 'customers'
  | 'cafeTables'
  | 'outlets'
  | 'modifierGroups'
  | 'modifierOptions'
  | 'settings'
  | 'auditLogs'

export type SyncOperation = 'upsert' | 'delete'
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
