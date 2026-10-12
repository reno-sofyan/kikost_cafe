import type { BusinessType, OrderType, PaymentMethod } from '@/types/domain'

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  cafe_resto: 'Kafe & Restoran',
  kantin: 'Kantin',
  minimarket: 'Minimarket & Ritel',
  lainnya: 'Lainnya',
}

export const BUSINESS_TYPE_DESCRIPTIONS: Record<BusinessType, string> = {
  cafe_resto: 'Meja, dapur, pesanan QR, dan pager — untuk makan/minum di tempat.',
  kantin: 'Nomor antrean, dapur, pesanan QR, dan pager — makan di tempat/bungkus tanpa meja & service charge.',
  minimarket: 'Kasir cepat: langsung pindai barcode, item sama otomatis dijumlahkan. Tanpa meja, dapur, antrean, modifier, atau resep.',
  lainnya: 'Semua fitur ditampilkan. Pilih ini bila tak ada yang cocok di atas.',
}

/** Urutan tampil di UI (onboarding, Pengaturan). */
export const BUSINESS_TYPE_ORDER: BusinessType[] = ['cafe_resto', 'kantin', 'minimarket', 'lainnya']

export interface BusinessFeatures {
  /** Menu "Meja" + denah lantai + QR per meja. */
  tables: boolean
  /** Menu "Dapur" (Kitchen Display System). */
  kitchen: boolean
  /** Menu "Pesanan QR" + tab Pengaturan → Meja & QR (pemesanan mandiri pelanggan). */
  qrOrdering: boolean
  /** Tab Pengaturan → Pager (pemanggil Retekess). */
  pager: boolean
  /** Tab Produk → Modifier + pilihan modifier di form produk (ukuran, level pedas, topping). */
  modifiers: boolean
  /** Resep/BOM di form produk + tab Stok → Produksi. */
  recipes: boolean
  /** Jenis pesanan yang ditawarkan di Kasir; elemen pertama = default. */
  orderTypes: OrderType[]
  /**
   * Mode kasir ritel: tanpa dialog "Pesanan Baru" — tap/pindai produk langsung
   * membuka transaksi (jenis `orderTypes[0]`) bila belum ada yang aktif.
   */
  quickSale: boolean
  /** Nomor antrean (#N) di kasir, struk, & layar sukses bayar — untuk memanggil pesanan. */
  queueNumbers: boolean
  /** Kasir wajib isi "Nama Pembeli" saat membuat pesanan — untuk memanggil pesanan di antrean. */
  buyerName: boolean
  /** Tap/pindai produk yang sama menambah qty baris yang ada, bukan baris baru. */
  stackSameItems: boolean
  /** Isian Service Charge di onboarding & Pengaturan → Pajak & Struk. */
  serviceCharge: boolean
  /** Metode bayar yang ditawarkan di layar pembayaran (urutan = urutan tombol). */
  paymentMethods: PaymentMethod[]
  /**
   * Metode yang WAJIB disertai foto bukti saat kasir membayar — harus foto, tanpa
   * jalan pintas "Tidak bisa ambil foto". Metode lain tetap boleh melampirkan
   * foto (atau alasan tanpa foto) secara opsional. Kosong = tak ada kewajiban.
   */
  paymentProofMethods: PaymentMethod[]
  /**
   * Pembatalan pesanan berisi item (belum dibayar maupun sudah) wajib alasan +
   * PIN akun berperan Pemilik — PIN supervisor/administrator tidak berlaku.
   */
  ownerPinCancel: boolean
  /**
   * Kode pembatalan HANYA dibuat di Konsol Pemilik online (/owner) — tablet tak bisa
   * membuatnya walau login sebagai Pemilik. Kode dicocokkan ke server (butuh internet).
   */
  ownerCodeOnlineOnly: boolean
  /**
   * "Tagihan Tertunda": pesanan internal dicatat & diteruskan ke dapur sekarang,
   * dibayar nanti. Tidak menghalangi tutup shift; pelunasannya masuk ke shift
   * yang sedang buka saat dibayar.
   */
  payLater: boolean
  /**
   * Diskon kasir terkendali: tiap diskon wajib alasan & tercatat (siapa, berapa);
   * di atas `AppSettings.cashierDiscountMaxPercent` wajib kode Pemilik. Retur
   * (pengembalian uang sebagian) juga wajib kode Pemilik.
   */
  cashierControls: boolean
  /** Notifikasi saat shift dibuka + popup tiap 21.00 WIB "lanjutkan atau tutup shift?". */
  shiftReminder: boolean
  /** Cetak tagihan sementara (pre-bill) untuk diantar ke meja sebelum tamu membayar. */
  preBill: boolean
  /** Tip/gratuity dicatat saat pembayaran — terpisah dari omzet. */
  tips: boolean
  /** Reservasi meja (butuh `tables`). */
  reservations: boolean
  /** Pelayan dicatat per pesanan + laporan penjualan per pelayan. */
  waiterTracking: boolean
  /** Pesanan online (GoFood/GrabFood/ShopeeFood/…): harga online, platform, laporan terpisah. */
  onlineOrders: boolean
  /** Promo otomatis terjadwal (happy hour, per kategori/produk) & kode voucher. */
  promos: boolean
  /** Member: poin dari tiap belanja, tukar poin jadi potongan, tingkatan member. */
  loyalty: boolean
  /** Menu paket/combo: satu harga, stok dipotong per produk isi paket. */
  combos: boolean
  /** Absensi karyawan (masuk/pulang dengan PIN) & rekap jam kerja. */
  attendance: boolean
  /**
   * Alat pengelola kafe & restoran: target waktu dapur + peringatan terlambat, struk &
   * ringkasan harian via WhatsApp, pesanan terjadwal, label/alergen menu, layar pelanggan.
   */
  proTools: boolean
}

const ALL_FEATURES: BusinessFeatures = {
  tables: true,
  kitchen: true,
  qrOrdering: true,
  pager: true,
  modifiers: true,
  recipes: true,
  orderTypes: ['dine_in', 'takeaway', 'delivery'],
  quickSale: false,
  queueNumbers: true,
  buyerName: false,
  stackSameItems: false,
  serviceCharge: true,
  paymentMethods: ['cash', 'qris', 'transfer', 'card'],
  paymentProofMethods: [],
  ownerPinCancel: false,
  ownerCodeOnlineOnly: false,
  payLater: false,
  cashierControls: false,
  shiftReminder: false,
  preBill: true,
  tips: true,
  reservations: true,
  waiterTracking: true,
  onlineOrders: true,
  promos: true,
  loyalty: true,
  combos: true,
  attendance: true,
  proTools: true,
}

/** Fitur layanan meja ala restoran — tak relevan untuk kantin & minimarket. */
const NO_TABLE_SERVICE = { preBill: false, tips: false, reservations: false, waiterTracking: false } as const

/** Fitur premium kafe & restoran — belum dipasang untuk kantin & minimarket. */
const NO_PREMIUM = { promos: false, loyalty: false, combos: false, attendance: false, proTools: false } as const

/**
 * Fitur yang relevan per jenis usaha. Ini HANYA mengatur apa yang TERLIHAT di
 * navigasi/pengaturan/kasir — tidak pernah memblokir rute atau data (produk
 * yang sudah punya modifier/resep tetap menampilkannya). Pemilik yang
 * salah pilih jenis usaha, atau berubah kebutuhan, tetap bisa mengakses semua
 * layar lewat URL langsung; mereka hanya perlu mengubah Jenis Usaha di
 * Pengaturan → Profil Usaha untuk memunculkannya lagi di navigasi.
 */
export function featuresForBusinessType(type: BusinessType): BusinessFeatures {
  switch (type) {
    case 'minimarket':
      return {
        tables: false,
        kitchen: false,
        qrOrdering: false,
        pager: false,
        modifiers: false,
        recipes: false,
        orderTypes: ['takeaway'],
        quickSale: true,
        queueNumbers: false,
        buyerName: false,
        stackSameItems: true,
        serviceCharge: false,
        paymentMethods: ['cash', 'qris', 'transfer', 'card'],
        paymentProofMethods: [],
        ownerPinCancel: false,
        ownerCodeOnlineOnly: false,
        payLater: false,
        cashierControls: false,
        shiftReminder: false,
        ...NO_TABLE_SERVICE,
        onlineOrders: false,
        ...NO_PREMIUM,
      }
    case 'kantin':
      return {
        ...ALL_FEATURES,
        tables: false,
        orderTypes: ['dine_in', 'takeaway'],
        buyerName: true,
        stackSameItems: true,
        serviceCharge: false,
        paymentMethods: ['cash', 'qris', 'transfer'],
        paymentProofMethods: ['qris', 'transfer'],
        ownerPinCancel: true,
        ownerCodeOnlineOnly: true,
        payLater: true,
        cashierControls: true,
        shiftReminder: true,
        ...NO_TABLE_SERVICE,
        onlineOrders: false,
        ...NO_PREMIUM,
      }
    case 'cafe_resto':
      // Pengaman kas kantin dipasang sebagian ke kafe (2026-10-11): kode Pemilik untuk
      // pembatalan/koreksi, diskon/retur terkendali, pengingat shift. QRIS/transfer wajib
      // foto & tagihan tertunda tetap TIDAK dipasang atas pilihan pemilik.
      return {
        ...ALL_FEATURES,
        ownerPinCancel: true,
        cashierControls: true,
        shiftReminder: true,
      }
    case 'lainnya':
    default:
      return ALL_FEATURES
  }
}

/** Apakah pembayaran dengan metode-metode ini wajib disertai foto bukti. */
export function requiresPaymentProof(features: Pick<BusinessFeatures, 'paymentProofMethods'>, methods: PaymentMethod[]): boolean {
  return methods.some((m) => features.paymentProofMethods.includes(m))
}
