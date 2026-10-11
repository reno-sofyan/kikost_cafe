import type { ProductSalesRow } from '@/db/repositories/reports'

/**
 * Analisis menu (menu engineering) — tiap menu diposisikan dari dua ukuran:
 * seberapa laris (jumlah terjual) dan seberapa untung (margin per porsi).
 *   Bintang  = laris & untung      → pertahankan, tonjolkan
 *   Andalan  = laris, margin tipis → naikkan harga / tekan HPP
 *   Potensi  = untung, kurang laku → promosikan
 *   Beban    = sepi & margin tipis → pertimbangkan dihapus
 */
export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog'

export const MENU_CLASS_INFO: Record<MenuClass, { label: string; summary: string; advice: string }> = {
  star: { label: 'Bintang', summary: 'Laris & untung', advice: 'Pertahankan kualitas, tonjolkan di menu.' },
  plowhorse: { label: 'Andalan', summary: 'Laris, margin tipis', advice: 'Naikkan harga sedikit atau tekan HPP.' },
  puzzle: { label: 'Potensi', summary: 'Untung, kurang laku', advice: 'Promosikan atau tawarkan lewat pelayan.' },
  dog: { label: 'Beban', summary: 'Sepi & margin tipis', advice: 'Pertimbangkan diganti atau dihapus.' },
}

export interface MenuEngineeringRow {
  productId: string
  productName: string
  qtySold: number
  revenue: number
  /** Margin kotor per porsi (harga jual rata-rata − HPP). */
  marginPerUnit: number
  marginTotal: number
  /** Persen dari seluruh porsi terjual. */
  mixPercent: number
  menuClass: MenuClass
  /** HPP belum diisi — marginnya tampak lebih besar dari yang sebenarnya. */
  missingCost: boolean
}

export interface MenuEngineering {
  rows: MenuEngineeringRow[]
  /** Batas "laris": 70% dari porsi rata-rata per menu (aturan umum menu engineering). */
  popularityThresholdPercent: number
  /** Batas "untung": margin rata-rata tertimbang per porsi. */
  averageMarginPerUnit: number
  counts: Record<MenuClass, number>
  missingCostCount: number
}

const CLASS_ORDER: MenuClass[] = ['star', 'plowhorse', 'puzzle', 'dog']

export function buildMenuEngineering(sales: ProductSalesRow[]): MenuEngineering {
  const sold = sales.filter((s) => s.qtySold > 0)
  const totalQty = sold.reduce((s, r) => s + r.qtySold, 0)
  const totalMargin = sold.reduce((s, r) => s + (r.revenue - r.costTotal), 0)
  const averageMarginPerUnit = totalQty > 0 ? totalMargin / totalQty : 0
  const popularityThresholdPercent = sold.length > 0 ? (100 / sold.length) * 0.7 : 0
  const counts: Record<MenuClass, number> = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 }
  const rows = sold.map((r): MenuEngineeringRow => {
    const marginTotal = r.revenue - r.costTotal
    const marginPerUnit = marginTotal / r.qtySold
    const mixPercent = (r.qtySold / totalQty) * 100
    const popular = mixPercent >= popularityThresholdPercent
    const profitable = marginPerUnit >= averageMarginPerUnit
    const menuClass: MenuClass = popular ? (profitable ? 'star' : 'plowhorse') : profitable ? 'puzzle' : 'dog'
    counts[menuClass] += 1
    return { productId: r.productId, productName: r.productName, qtySold: r.qtySold, revenue: r.revenue, marginPerUnit, marginTotal, mixPercent, menuClass, missingCost: r.costTotal <= 0 }
  })
  rows.sort((a, b) => CLASS_ORDER.indexOf(a.menuClass) - CLASS_ORDER.indexOf(b.menuClass) || b.marginTotal - a.marginTotal)
  return { rows, popularityThresholdPercent, averageMarginPerUnit, counts, missingCostCount: rows.filter((r) => r.missingCost).length }
}
