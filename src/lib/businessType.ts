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
   * "Bill Gantung": pesanan internal dicatat & diteruskan ke dapur sekarang,
   * dibayar nanti. Tidak menghalangi tutup shift; pelunasannya masuk ke shift
   * yang sedang buka saat dibayar.
   */
  payLater: boolean
  /** Notifikasi saat shift dibuka + popup tiap 21.00 WIB "lanjutkan atau tutup shift?". */
  shiftReminder: boolean
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
  payLater: false,
  shiftReminder: false,
}

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
        payLater: false,
        shiftReminder: false,
      }
    case 'kantin':
      return {
        ...ALL_FEATURES,
        tables: false,
        orderTypes: ['dine_in', 'takeaway'],
        buyerName: true,
        stackSameItems: true,
        serviceCharge: false,
        paymentMethods: ['cash', 'qris'],
        paymentProofMethods: ['qris'],
        ownerPinCancel: true,
        payLater: true,
        shiftReminder: true,
      }
    case 'cafe_resto':
      return ALL_FEATURES
    case 'lainnya':
    default:
      return ALL_FEATURES
  }
}

/** Apakah pembayaran dengan metode-metode ini wajib disertai foto bukti. */
export function requiresPaymentProof(features: Pick<BusinessFeatures, 'paymentProofMethods'>, methods: PaymentMethod[]): boolean {
  return methods.some((m) => features.paymentProofMethods.includes(m))
}
