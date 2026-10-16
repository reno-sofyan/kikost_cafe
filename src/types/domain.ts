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

/** Tarif gaji: `hourly` = per jam kerja tercatat, `daily` = per hari hadir. Nama di-snapshot
 *  karena data pengguna tidak disinkronkan. */
export interface StaffPay {
  name: string
  type: 'hourly' | 'daily'
  rate: number
}

/** Jadwal mingguan berulang. Kunci `days` = hari 0 (Minggu) … 6 (Sabtu); jam "HH:MM" WIB.
 *  Hari tanpa entri = libur. `end` lebih kecil dari `start` = shift melewati tengah malam. */
export interface StaffRoster {
  name: string
  days: Partial<Record<number, { start: string; end: string }>>
}

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
  /**
   * QRIS di kasir: `static` = gambar QRIS tetap (kasir konfirmasi manual + foto
   * bukti bila diwajibkan); `midtrans` = QR dinamis per transaksi via backend,
   * lunas otomatis saat Midtrans mengonfirmasi. Kosong = data lama → static.
   */
  qrisProvider?: 'static' | 'midtrans'
  /** Persen komisi tiap platform pesanan online (mis. GoFood 20) — untuk estimasi pendapatan bersih. */
  onlineCommissionPercent?: Partial<Record<OnlinePlatform, number>>
  /** Aturan promo otomatis & voucher (kafe & restoran). */
  promos?: Promo[]
  /** KOL / influencer rekanan (pemilik kode voucher). */
  kols?: Kol[]
  /** Riwayat pembayaran komisi ke KOL. Terutang = komisi dari transaksi lunas − total di sini. */
  kolPayouts?: KolPayout[]
  /** Target omzet (Rp) per hari & per bulan untuk indikator pencapaian di Laporan. */
  salesTargets?: { daily?: number; monthly?: number }
  /** Program member & poin loyalitas. Kosong = belum diaktifkan. */
  loyalty?: LoyaltySettings
  /** Batas menit penyiapan dapur/bar — lewat dari ini pesanan ditandai terlambat. 0 = tanpa batas. Default 15. */
  kitchenTargetMinutes?: number
  /** Batas menit tamu menempati meja sebelum ditandai "lama" di denah. 0 = tanpa batas. Default 90. */
  tableLongStayMinutes?: number
  /** Nomor WhatsApp pemilik — tujuan ringkasan harian saat tutup shift. */
  ownerWhatsapp?: string
  /** Tarif gaji per karyawan (kunci = id pengguna) — dasar rekap gaji dari absensi. */
  staffPay?: Record<string, StaffPay>
  /** Jadwal kerja mingguan per karyawan (kunci = id pengguna). */
  staffRoster?: Record<string, StaffRoster>
  /** Kantin: diskon kasir di atas persen ini (dari subtotal) wajib kode Pemilik. Default 10. */
  cashierDiscountMaxPercent?: number
  /** Basis URL publik halaman pesan-mandiri (mis. https://pesan.usahaanda.com). Kosong = pakai origin perangkat. QR berisi `<base>/order/<token>`. */
  qrOrderBaseUrl: string
  /**
   * Fitur & Akses (Pengaturan): menu samping mana yang dipakai dan peran mana yang
   * boleh membukanya. Kunci = `NavKey`; yang tak diisi memakai bawaan jenis usaha.
   */
  navAccess?: Partial<Record<string, { enabled?: boolean; roles?: Role[] }>>
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
  /** Cetak logo usaha di kepala struk thermal. Kosong = ya (bila logo diunggah). */
  printLogo?: boolean
  /** Buka laci kasir (lewat printer kasir) tiap pembayaran tunai. `undefined`
   *  (pengaturan lama) = aktif. */
  openDrawerOnCash?: boolean
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
  /** Harga jual khusus pesanan online (biasanya dinaikkan untuk menutup komisi platform).
   *  Kosong/0 = sama dengan `price`. */
  onlinePrice?: number | null
  /** Harga khusus per aplikasi (mengalahkan `onlinePrice`). Kosong = ikut harga online umum. */
  platformPrices?: Partial<Record<OnlinePlatform, number>> | null
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
  /** Menu paket/combo: daftar produk isi paket. Kosong = produk biasa. */
  comboItems?: { productId: string; qty: number }[]
  /** Label menu & info alergen (lihat `lib/productTags.ts`), mis. `spicy`, `nuts`. */
  tags?: string[]
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

export type ReservationStatus = 'booked' | 'seated' | 'cancelled' | 'no_show'

/**
 * Reservasi meja (kafe & restoran). `tableId` boleh kosong — meja bisa ditentukan
 * belakangan. Saat tamu datang ("Dudukkan") reservasi menjadi `seated` dan
 * `orderId` menunjuk pesanan yang dibuka untuknya.
 */
export interface Reservation {
  id: string
  customerName: string
  phone: string
  guestCount: number
  /** Waktu kedatangan yang dipesan (epoch ms). */
  reservedAt: number
  tableId: string | null
  note: string
  status: ReservationStatus
  /** Tamu datang langsung & menunggu meja (daftar tunggu) — `reservedAt` = saat didaftarkan. */
  walkIn?: boolean
  /** Pesanan terjadwal/katering: daftar menu untuk `reservedAt`, dengan atau tanpa uang muka. */
  preOrder?: PreOrderInfo
  orderId: string | null
  createdByUserId: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

export interface PreOrderLine {
  productId: string
  name: string
  qty: number
  /** Harga saat dipesan — hanya perkiraan; harga final mengikuti menu saat pesanan diproses. */
  unitPrice: number
  note: string
  /** Pilihan modifier (ukuran, level gula, topping) yang diminta tamu. */
  modifiers?: OrderItemModifierSnapshot[]
}

export interface PreOrderInfo {
  lines: PreOrderLine[]
  fulfillment: 'dine_in' | 'takeaway'
  /** Uang muka disimpan sebagai voucher hadiah (titipan) berkode ini; dipakai saat pelunasan. */
  depositCode?: string | null
  depositAmount?: number
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
  /** Tanggal lahir "YYYY-MM-DD" — dasar promo ulang tahun. */
  birthDate?: string | null
  /** Koreksi poin manual (+/−). Saldo poin = poin didapat − ditukar (dari transaksi lunas) + koreksi ini. */
  pointsAdjustment?: number
  /** Rincian bertanggal dari `pointsAdjustment` — dibutuhkan untuk menghitung masa berlaku poin. */
  pointsLog?: PointsLogEntry[]
  /** Isi & tarik saldo member. Saldo = jumlah di sini − pembayaran bermetode `deposit` milik pelanggan ini. */
  depositLog?: DepositEntry[]
  /**
   * Voucher hadiah (gift card): dicatat sebagai "pelanggan" khusus supaya saldo,
   * penggabungan antar-perangkat, & pembukuannya memakai mekanisme saldo member.
   * Tidak tampil di daftar pelanggan.
   */
  giftCard?: { code: string; recipient: string } | null
  createdAt: number
  updatedAt: number
}

/** `delivery` = pesanan ONLINE (GoFood/GrabFood/ShopeeFood/dll.) — di UI berlabel "Online". */
export type OrderType = 'dine_in' | 'takeaway' | 'delivery'

export type OnlinePlatform = 'gofood' | 'grabfood' | 'shopeefood' | 'other'
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
  /** Snapshot kategori produk saat ditambahkan — dasar promo per kategori. */
  categoryId?: string | null
  /** Menu paket: komponen per 1 paket. Stok dipotong per komponen, bukan dari produk paketnya. */
  comboComponents?: ComboComponent[]
  /** Urutan saji: 1 Pembuka, 2 Utama, 3 Penutup. Kosong = langsung dikirim. */
  course?: number | null
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

/**
 * Aturan promo (kafe & restoran). Tanpa `voucherCode` = promo OTOMATIS: terpasang
 * sendiri di kasir saat syaratnya terpenuhi. Dengan `voucherCode` = voucher: hanya
 * terpasang bila kasir memasukkan kodenya. Disimpan di `AppSettings.promos`.
 */
export type PromoKind = DiscountType | 'bxgy'

export interface Promo {
  id: string
  name: string
  active: boolean
  /** `bxgy` = beli X gratis Y: tiap (buyQty + getQty) item yang cocok, getQty termurah gratis. */
  kind: PromoKind
  value: number
  buyQty?: number
  getQty?: number
  /** Hanya untuk pesanan yang sudah dikaitkan dengan pelanggan terdaftar. */
  memberOnly?: boolean
  /** Tiap member hanya boleh memakainya sekali (transaksi lunas). */
  oncePerCustomer?: boolean
  /** Promo ulang tahun: berlaku di hari / bulan lahir member, sekali per tahun. */
  birthday?: 'day' | 'month' | null
  /** Dasar potongan: seluruh pesanan, atau hanya item dari kategori/produk tertentu. */
  scope: 'order' | 'category' | 'product'
  targetIds: string[]
  minSubtotal?: number
  /** Batas atas potongan (Rp) — berguna untuk promo persen. */
  maxDiscount?: number
  /** Hari berlaku (0 = Minggu … 6 = Sabtu). Kosong = setiap hari. */
  days?: number[]
  /** Jam berlaku WIB "HH:MM" (happy hour). Keduanya kosong = sepanjang hari. */
  startTime?: string
  endTime?: string
  /** Rentang tanggal berlaku "YYYY-MM-DD" (inklusif). */
  startDate?: string
  endDate?: string
  /** Kosong = dine-in & takeaway. Pesanan online hanya bila dipilih eksplisit. */
  orderTypes?: OrderType[]
  voucherCode?: string | null
  /** Voucher: batas jumlah pemakaian (transaksi lunas). Kosong = tak terbatas. */
  usageLimit?: number | null
  /** Voucher milik seorang KOL — pemakaiannya dihitung sebagai penjualan & komisi KOL itu. */
  kolId?: string | null
  createdAt: number
  updatedAt: number
}

/**
 * KOL / influencer yang bekerja sama. Tiap KOL punya satu atau lebih kode voucher
 * (Promo ber-`kolId`); laporan menghitung transaksi, omzet, & komisinya.
 * Disimpan di `AppSettings.kols`.
 */
export interface Kol {
  id: string
  name: string
  /** Mis. "Instagram", "TikTok". */
  platform: string
  /** Nama akun, mis. "@kulinerbandung". */
  handle: string
  phone: string
  /** Persen komisi dari penjualan bersih transaksi yang memakai vouchernya. 0 = tanpa komisi. */
  commissionPercent: number
  active: boolean
  note: string
  createdAt: number
  updatedAt: number
}

/** Pembayaran komisi ke seorang KOL (nama di-snapshot agar tetap terbaca setelah KOL dihapus). */
export interface KolPayout {
  id: string
  kolId: string
  kolName: string
  amount: number
  note: string
  userId: string
  userName: string
  createdAt: number
}

export interface PointsLogEntry {
  at: number
  delta: number
  reason: string
}

/** Positif = isi saldo, negatif = tarik/koreksi. */
export interface DepositEntry {
  id: string
  at: number
  amount: number
  method: PaymentMethod
  note: string
  shiftId: string | null
  userId: string
  userName: string
}

/** Promo/voucher yang terpasang di sebuah pesanan (snapshot nama & nilai potongan). */
export interface AppliedPromo {
  promoId: string
  name: string
  amount: number
  voucherCode?: string | null
  /** Snapshot KOL pemilik voucher & persen komisinya saat dipakai. */
  kolId?: string | null
  kolName?: string | null
  kolCommissionPercent?: number
}

export interface LoyaltyTier {
  name: string
  /** Total belanja seumur hidup (Rp) untuk mencapai tier ini. */
  minSpend: number
  /** Pengali poin yang didapat, mis. 1.25. */
  multiplier: number
}

export interface LoyaltySettings {
  enabled: boolean
  /** Tiap sekian rupiah penjualan bersih = 1 poin. */
  earnPerAmount: number
  /** Nilai tukar 1 poin (Rp) saat dipakai sebagai potongan. */
  pointValue: number
  /** Minimal poin sekali tukar. */
  minRedeem: number
  tiers: LoyaltyTier[]
  /** Poin hangus sekian bulan setelah didapat. 0/kosong = tidak pernah hangus. */
  expiryMonths?: number
  /** Saldo member (deposit): pelanggan isi saldo di muka lalu membayar dengan saldo. */
  depositEnabled?: boolean
}

/** Isi sebuah menu paket: produk komponen & jumlahnya per 1 paket. */
export interface ComboComponent {
  productId: string
  name: string
  qty: number
}

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
  /** TOTAL potongan pesanan: diskon manual + promo/voucher + tukar poin. */
  discountAmount: number
  /** Promo otomatis & voucher yang terpasang (dihitung ulang selama pesanan masih terbuka). */
  appliedPromos?: AppliedPromo[]
  voucherCode?: string | null
  /** Bagian `discountAmount` yang berasal dari promo, voucher, & tukar poin (bukan diskon manual). */
  promoDiscountAmount?: number
  /** Poin member yang ditukar di pesanan ini & nilai tukar per poin saat itu. */
  pointsRedeemed?: number
  pointsRedeemValue?: number
  /** Poin yang didapat pelanggan dari pesanan ini — diisi saat lunas. */
  pointsEarned?: number
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
  /** Pesanan online (`type: 'delivery'`): platform asal & nomor pesanan di aplikasinya. */
  onlinePlatform?: OnlinePlatform | null
  onlineOrderRef?: string | null
  /** Snapshot persen komisi platform saat pesanan dibuat — dasar estimasi "diterima bersih". */
  onlineCommissionPercent?: number
  /** Pesanan terjadwal: kode voucher uang muka yang sudah dibayar tamu — ditawarkan di layar bayar. */
  prepaidCode?: string | null
  /** Pelayan yang melayani pesanan ini (kafe & restoran) — nama di-snapshot karena
   *  data pengguna tidak disinkronkan. Kosong = tidak dicatat. */
  waiterId?: string | null
  waiterName?: string | null
  /** Tagihan sementara (pre-bill) terakhir dicetak & berapa kali — sebelum dibayar. */
  billPrintedAt?: number | null
  billPrintCount?: number
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
  /** Alasan, pemberi, & persetujuan diskon (kantin, sejak v1.0.18). */
  discountReason?: string | null
  discountByName?: string | null
  discountApproval?: 'self' | 'owner_code' | null
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

/** `platform` = dibayar pelanggan lewat aplikasi pesan-antar; dicairkan platform belakangan (piutang). */
/** `deposit` = dibayar dari saldo member; `giftcard` = dari voucher hadiah (uangnya sudah diterima di muka). */
export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'card' | 'platform' | 'deposit' | 'giftcard'

export interface PaymentInput {
  method: PaymentMethod
  amount: number
  receivedAmount?: number
  reference?: string
  /** Tip dari tamu yang ikut dibayar lewat metode ini — DI LUAR `amount`. */
  tipAmount?: number
  /** Dikonfirmasi gateway (QRIS dinamis Midtrans) — bukti = transaksi gateway, tak perlu foto. */
  gateway?: 'midtrans'
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
   * Tip (gratuity) yang diterima bersama pembayaran ini. BUKAN omzet dan TIDAK
   * termasuk `amount`; tip tunai ikut masuk laci (kas seharusnya). Kosong = 0.
   */
  tipAmount?: number
  /**
   * Kunci idempotensi bisnis — deterministik dari (orderId, method, amount, urutan).
   * Dua perangkat yang memproses pembayaran yang sama menghasilkan id yang sama → LWW dedup.
   */
  idempotencyKey: string
  /** Pembayaran `deposit`: pemilik saldo yang dipotong (pembalik ikut menyalinnya). */
  customerId?: string | null
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
  | 'reservations'
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
