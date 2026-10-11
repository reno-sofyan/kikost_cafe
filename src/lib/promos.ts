import { jakartaDateKey } from '@/lib/datetime'
import type { AppliedPromo, Kol, Order, OrderItem, OrderType, Promo } from '@/types/domain'

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000

export const PROMO_DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

/** Kode voucher dibandingkan tanpa peduli huruf besar/kecil & spasi. */
export function normalizeVoucherCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

/** Apakah promo berlaku pada waktu & jenis pesanan ini (zona Asia/Jakarta). */
export function isPromoActiveAt(promo: Promo, now: number, orderType: OrderType): boolean {
  if (!promo.active) return false
  // Harga aplikasi pesan-antar sudah final — promo toko tak ikut kecuali dipilih eksplisit.
  const types = promo.orderTypes?.length ? promo.orderTypes : (['dine_in', 'takeaway'] as OrderType[])
  if (!types.includes(orderType)) return false
  const dateKey = jakartaDateKey(now)
  if (promo.startDate && dateKey < promo.startDate) return false
  if (promo.endDate && dateKey > promo.endDate) return false
  const local = new Date(now + JAKARTA_OFFSET_MS)
  if (promo.days?.length && !promo.days.includes(local.getUTCDay())) return false
  if (promo.startTime && promo.endTime) {
    const hhmm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
    const inWindow =
      promo.startTime <= promo.endTime
        ? hhmm >= promo.startTime && hhmm < promo.endTime
        : hhmm >= promo.startTime || hhmm < promo.endTime // melewati tengah malam
    if (!inWindow) return false
  }
  return true
}

type PromoItem = Pick<OrderItem, 'productId' | 'categoryId' | 'lineTotal' | 'voided' | 'removed'> & { qty?: number }

/** Pelanggan pesanan sejauh yang dibutuhkan syarat promo. */
export type PromoCustomer = { id: string; birthDate?: string | null }

/** Apakah `now` jatuh di hari/bulan ulang tahun (WIB). Lahir 29 Feb dirayakan 28 Feb di tahun biasa. */
export function isBirthdayAt(birthDate: string | null | undefined, now: number, window: 'day' | 'month'): boolean {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(birthDate ?? '')
  if (!m) return false
  const [year, month, day] = jakartaDateKey(now).split('-')
  if (m[1] !== month) return false
  if (window === 'month') return true
  const leap = (Number(year) % 4 === 0 && Number(year) % 100 !== 0) || Number(year) % 400 === 0
  const birthDay = m[1] === '02' && m[2] === '29' && !leap ? '28' : m[2]
  return birthDay === day
}

/**
 * Promo yang sudah "habis jatahnya" untuk seorang member, dari riwayat transaksi
 * lunasnya: promo sekali-per-member yang pernah dipakai, dan promo ulang tahun
 * yang sudah dipakai di tahun kalender ini.
 */
export function usedUpPromoIds(promos: Promo[], pastUsages: { promoId: string; at: number }[], now: number): Set<string> {
  const year = jakartaDateKey(now).slice(0, 4)
  const used = new Set<string>()
  for (const promo of promos) {
    if (!promo.birthday && !promo.oncePerCustomer) continue
    const hit = pastUsages.some((u) => u.promoId === promo.id && (!promo.birthday || promo.oncePerCustomer || jakartaDateKey(u.at).slice(0, 4) === year))
    if (hit) used.add(promo.id)
  }
  return used
}

/** Alasan promo TIDAK berlaku untuk pelanggan ini (null = boleh). Pesannya ditampilkan ke kasir. */
export function promoCustomerBlock(promo: Promo, customer: PromoCustomer | null | undefined, usedPromoIds: Set<string> | undefined, now: number): string | null {
  const needsMember = promo.memberOnly || promo.oncePerCustomer || !!promo.birthday
  if (!needsMember) return null
  if (!customer) return 'Promo ini khusus member — pilih pelanggan terlebih dahulu.'
  if (promo.birthday) {
    if (!customer.birthDate) return 'Tanggal lahir member belum diisi.'
    if (!isBirthdayAt(customer.birthDate, now, promo.birthday)) return `Promo ini hanya berlaku di ${promo.birthday === 'day' ? 'hari' : 'bulan'} ulang tahun member.`
  }
  if (usedPromoIds?.has(promo.id)) return promo.birthday && !promo.oncePerCustomer ? 'Promo ulang tahun sudah dipakai member ini tahun ini.' : 'Member ini sudah pernah memakai promo ini.'
  return null
}

/** Potongan (Rp) sebuah promo untuk isi pesanan ini; 0 bila syaratnya tak terpenuhi. */
export function promoDiscountFor(promo: Promo, items: PromoItem[]): number {
  const active = items.filter((i) => !i.voided && !i.removed)
  const subtotal = active.reduce((s, i) => s + i.lineTotal, 0)
  if (subtotal <= 0 || subtotal < (promo.minSubtotal ?? 0)) return 0
  const base =
    promo.scope === 'order'
      ? subtotal
      : active
          .filter((i) => promo.targetIds.includes(promo.scope === 'product' ? i.productId : (i.categoryId ?? '')))
          .reduce((s, i) => s + i.lineTotal, 0)
  if (base <= 0) return 0
  if (promo.kind === 'bxgy') {
    // Tiap (beli + gratis) unit yang cocok → `gratis` unit TERMURAH tak dibayar.
    const buy = Math.max(1, Math.floor(promo.buyQty ?? 1))
    const get = Math.max(1, Math.floor(promo.getQty ?? 1))
    const units: number[] = []
    for (const i of active) {
      if (promo.scope !== 'order' && !promo.targetIds.includes(promo.scope === 'product' ? i.productId : (i.categoryId ?? ''))) continue
      const qty = Math.max(0, Math.floor(i.qty ?? 1))
      for (let n = 0; n < qty; n++) units.push(i.lineTotal / qty)
    }
    const free = Math.floor(units.length / (buy + get)) * get
    const freeValue = units.sort((a, b) => a - b).slice(0, free).reduce((s, u) => s + u, 0)
    return Math.max(0, Math.round(promo.maxDiscount && promo.maxDiscount > 0 ? Math.min(freeValue, promo.maxDiscount) : freeValue))
  }
  let amount = promo.kind === 'percent' ? (base * Math.min(100, Math.max(0, promo.value))) / 100 : Math.min(promo.value, base)
  if (promo.maxDiscount && promo.maxDiscount > 0) amount = Math.min(amount, promo.maxDiscount)
  return Math.max(0, Math.round(amount))
}

/**
 * Promo yang terpasang di sebuah pesanan: SATU promo otomatis (yang potongannya
 * terbesar — promo otomatis tak ditumpuk) ditambah voucher bila kodenya diisi.
 */
export function evaluatePromos(params: {
  promos: Promo[]
  items: PromoItem[]
  orderType: OrderType
  now: number
  voucherCode?: string | null
  /** Untuk men-snapshot KOL pemilik voucher & komisinya. */
  kols?: Kol[]
  /** Pelanggan pesanan & promo yang jatahnya sudah habis baginya (lihat `usedUpPromoIds`). */
  customer?: PromoCustomer | null
  usedPromoIds?: Set<string>
}): AppliedPromo[] {
  const eligible = params.promos.filter(
    (p) => isPromoActiveAt(p, params.now, params.orderType) && !promoCustomerBlock(p, params.customer, params.usedPromoIds, params.now),
  )
  const applied: AppliedPromo[] = []

  let best: AppliedPromo | null = null
  for (const promo of eligible) {
    if (normalizeVoucherCode(promo.voucherCode)) continue
    const amount = promoDiscountFor(promo, params.items)
    if (amount > 0 && (!best || amount > best.amount)) best = { promoId: promo.id, name: promo.name, amount }
  }
  if (best) applied.push(best)

  const code = normalizeVoucherCode(params.voucherCode)
  if (code) {
    const voucher = eligible.find((p) => normalizeVoucherCode(p.voucherCode) === code)
    const amount = voucher ? promoDiscountFor(voucher, params.items) : 0
    if (voucher && amount > 0) {
      const kol = voucher.kolId ? params.kols?.find((k) => k.id === voucher.kolId) : undefined
      applied.push({
        promoId: voucher.id,
        name: voucher.name,
        amount,
        voucherCode: code,
        ...(kol ? { kolId: kol.id, kolName: kol.name, kolCommissionPercent: Math.min(100, Math.max(0, kol.commissionPercent)) } : {}),
      })
    }
  }
  return applied
}

/** Ringkasan syarat promo untuk daftar & struk, mis. "20% • Kopi • Sen–Jum 14:00–17:00". */
export function describePromo(promo: Promo, formatRupiah: (n: number) => string): string {
  const parts: string[] = [
    promo.kind === 'bxgy' ? `Beli ${promo.buyQty ?? 1} gratis ${promo.getQty ?? 1}` : promo.kind === 'percent' ? `${promo.value}%` : formatRupiah(promo.value),
  ]
  if (promo.birthday) parts.push(promo.birthday === 'day' ? 'hari ulang tahun' : 'bulan ulang tahun')
  else if (promo.memberOnly || promo.oncePerCustomer) parts.push('khusus member')
  if (promo.oncePerCustomer) parts.push('1× per member')
  if (promo.maxDiscount) parts.push(`maks. ${formatRupiah(promo.maxDiscount)}`)
  if (promo.minSubtotal) parts.push(`min. belanja ${formatRupiah(promo.minSubtotal)}`)
  if (promo.days?.length && promo.days.length < 7) parts.push([...promo.days].sort().map((d) => PROMO_DAY_LABELS[d]).join(', '))
  if (promo.startTime && promo.endTime) parts.push(`${promo.startTime}–${promo.endTime}`)
  if (promo.startDate || promo.endDate) parts.push(`${promo.startDate ?? '…'} s.d. ${promo.endDate ?? '…'}`)
  return parts.join(' • ')
}

/**
 * Rincian potongan sebuah pesanan untuk keranjang & struk: tiap promo/voucher,
 * tukar poin, lalu sisa sebagai diskon manual. Jumlahnya = `order.discountAmount`.
 */
export function discountLinesOf(
  order: Pick<Order, 'discountAmount' | 'appliedPromos' | 'pointsRedeemed' | 'pointsRedeemValue'>,
): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = []
  let remaining = Math.max(0, order.discountAmount)
  const take = (label: string, amount: number) => {
    const a = Math.min(remaining, Math.max(0, Math.round(amount)))
    if (a > 0) lines.push({ label, amount: a })
    remaining -= a
  }
  for (const p of order.appliedPromos ?? []) take(p.voucherCode ? `Voucher ${p.voucherCode}` : `Promo ${p.name}`, p.amount)
  if (order.pointsRedeemed) take(`Tukar ${order.pointsRedeemed} poin`, order.pointsRedeemed * (order.pointsRedeemValue ?? 0))
  if (remaining > 0) lines.push({ label: 'Diskon', amount: remaining })
  return lines
}
