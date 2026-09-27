import type { BusinessType } from '@/types/domain'

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  cafe_resto: 'Kafe & Restoran',
  kantin: 'Kantin',
  minimarket: 'Minimarket & Ritel',
  lainnya: 'Lainnya',
}

export const BUSINESS_TYPE_DESCRIPTIONS: Record<BusinessType, string> = {
  cafe_resto: 'Meja, dapur, pesanan QR, dan pager — untuk makan/minum di tempat.',
  kantin: 'Dapur dan pesanan QR aktif, tanpa pengelolaan meja per pelanggan.',
  minimarket: 'Kasir cepat, stok & barcode — tanpa meja, dapur, atau pesanan QR.',
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
}

const ALL_FEATURES: BusinessFeatures = { tables: true, kitchen: true, qrOrdering: true, pager: true }

/**
 * Fitur yang relevan per jenis usaha. Ini HANYA mengatur apa yang TERLIHAT di
 * navigasi/pengaturan — tidak pernah memblokir rute atau data. Pemilik yang
 * salah pilih jenis usaha, atau berubah kebutuhan, tetap bisa mengakses semua
 * layar lewat URL langsung; mereka hanya perlu mengubah Jenis Usaha di
 * Pengaturan → Profil Usaha untuk memunculkannya lagi di navigasi.
 */
export function featuresForBusinessType(type: BusinessType): BusinessFeatures {
  switch (type) {
    case 'minimarket':
      return { tables: false, kitchen: false, qrOrdering: false, pager: false }
    case 'kantin':
      return { tables: false, kitchen: true, qrOrdering: true, pager: true }
    case 'cafe_resto':
      return ALL_FEATURES
    case 'lainnya':
    default:
      return ALL_FEATURES
  }
}
