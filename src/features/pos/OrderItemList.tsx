import { useEffect, useRef, useState } from 'react'
import { isItemSentToKitchen } from '@/db/repositories/orders'
import { COURSE_LABELS } from '@/lib/courses'
import { formatRupiah } from '@/lib/currency'
import { modifiersTotal } from '@/lib/orderTotals'
import { Icon } from '@/components/ui/Icon'
import type { OrderItem } from '@/types/domain'

interface OrderItemListProps {
  orderId: string
  items: OrderItem[]
  /** Usaha berdapur: pisahkan "Sudah dikirim" dari "Tambahan baru" (repeat order). */
  splitSent: boolean
  courseMode: boolean
  heldCourse: number | null
  /** `large` = tampilan Perbesar (dibacakan ke pelanggan). */
  size?: 'normal' | 'large'
  onQtyChange: (item: OrderItem, delta: number) => void
  onOpenItem: (item: OrderItem) => void
}

/**
 * Daftar item keranjang kasir: satu item = satu baris (stepper • nama • harga), detail
 * (modifier, catatan, urutan saji) hanya bila ada. Tap nama → sheet detail item.
 * Item yang baru ditambah/diubah jumlahnya digulir ke pandangan dan disorot sebentar.
 */
export function OrderItemList({ orderId, items, splitSent, courseMode, heldCourse, size = 'normal', onQtyChange, onOpenItem }: OrderItemListProps) {
  const [sentCollapsed, setSentCollapsed] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const prevRef = useRef<{ orderId: string; qty: Map<string, number> } | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const sent = splitSent ? items.filter(isItemSentToKitchen) : []
  const fresh = sent.length > 0 ? items.filter((i) => !isItemSentToKitchen(i)) : items

  // Bandingkan jumlah per item dengan render sebelumnya; pesanan lain / tampilan baru tak disorot.
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = { orderId, qty: new Map(items.map((i) => [i.id, i.qty])) }
    if (!prev || prev.orderId !== orderId) return
    const target = items.filter((i) => prev.qty.get(i.id) !== i.qty).pop()
    if (!target) return
    if (splitSent && isItemSentToKitchen(target)) setSentCollapsed(false)
    setFlashId(target.id)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashId(null), 1000)
    requestAnimationFrame(() => rowRefs.current.get(target.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [items, orderId, splitSent])

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-300">Keranjang kosong — tap produk di kiri.</p>
  }

  const large = size === 'large'
  const row = (item: OrderItem, isNew: boolean) => (
    <ItemRow
      key={item.id}
      item={item}
      large={large}
      isNew={isNew}
      flash={flashId === item.id}
      courseMode={courseMode}
      heldCourse={heldCourse}
      rowRef={(el) => {
        if (el) rowRefs.current.set(item.id, el)
        else rowRefs.current.delete(item.id)
      }}
      onQtyChange={onQtyChange}
      onOpenItem={onOpenItem}
    />
  )

  if (sent.length === 0) return <div>{items.map((i) => row(i, false))}</div>

  const headClass = `flex w-full items-center gap-2 px-2 font-semibold uppercase tracking-wide ${large ? 'min-h-[3rem] text-sm' : 'min-h-[2.75rem] text-xs'}`
  return (
    <div>
      <button className={`${headClass} text-ink-300`} aria-expanded={!sentCollapsed} onClick={() => setSentCollapsed((v) => !v)}>
        <Icon name="checkCircle" size={large ? 18 : 15} className="flex-none text-success-500" />
        <span className="flex-1 text-left">Sudah dikirim ({sent.length})</span>
        <Icon name={sentCollapsed ? 'chevronDown' : 'chevronUp'} size={large ? 20 : 16} className="flex-none" />
      </button>
      {!sentCollapsed && sent.map((i) => row(i, false))}
      {fresh.length > 0 && (
        <>
          <div className={`${headClass} mt-1 text-brand-400`}>
            <Icon name="plus" size={large ? 18 : 15} className="flex-none" />
            <span>Tambahan baru ({fresh.length})</span>
          </div>
          {fresh.map((i) => row(i, true))}
        </>
      )}
    </div>
  )
}

function ItemRow({
  item,
  large,
  isNew,
  flash,
  courseMode,
  heldCourse,
  rowRef,
  onQtyChange,
  onOpenItem,
}: {
  item: OrderItem
  large: boolean
  isNew: boolean
  flash: boolean
  courseMode: boolean
  heldCourse: number | null
  rowRef: (el: HTMLDivElement | null) => void
  onQtyChange: (item: OrderItem, delta: number) => void
  onOpenItem: (item: OrderItem) => void
}) {
  const details: string[] = []
  if (item.qty > 1) details.push(`@ ${formatRupiah(item.unitPrice + modifiersTotal(item.modifiers))}`)
  for (const m of item.modifiers) details.push(`${m.groupName} : ${m.optionName}${m.priceDelta > 0 ? ` (+${formatRupiah(m.priceDelta)})` : ''}`)
  if (courseMode && !item.skipKitchen && item.course) {
    details.push(`${COURSE_LABELS[item.course]}${item.kitchenPrintedAt == null && heldCourse != null && item.course > heldCourse ? ' • ditahan' : ''}`)
  }
  const kitchenLabel = !item.skipKitchen && item.kitchenStatus !== 'new' ? `Dapur: ${item.kitchenStatus}` : null

  const stepBtn = `flex flex-none items-center justify-center rounded-lg bg-brand-600/12 text-brand-700 hover:bg-brand-600/20 ${large ? 'h-14 w-14' : 'h-11 w-11'}`
  return (
    <div
      ref={rowRef}
      data-order-item
      className={`flex items-start gap-2.5 border-b border-l-[3px] border-b-ink-700 py-2 pl-1.5 pr-2 transition-colors duration-500 ${
        isNew ? 'border-l-brand-500' : 'border-l-transparent'
      } ${flash ? 'bg-brand-600/12' : ''}`}
    >
      <div className="flex flex-none items-center">
        <button className={stepBtn} aria-label={`Kurangi jumlah ${item.productName}`} onClick={() => onQtyChange(item, -1)}>
          <Icon name="minus" size={large ? 22 : 18} />
        </button>
        <span className={`text-center font-bold tabular-nums text-ink-50 ${large ? 'w-12 text-[1.5rem]' : 'w-9 text-[1.1rem]'}`}>{item.qty}</span>
        <button className={stepBtn} aria-label={`Tambah jumlah ${item.productName}`} onClick={() => onQtyChange(item, 1)}>
          <Icon name="plus" size={large ? 22 : 18} />
        </button>
      </div>
      <button
        className={`min-w-0 flex-1 self-stretch text-left ${large ? 'py-2.5' : 'py-[0.6rem]'}`}
        aria-label={`Detail ${item.productName}`}
        onClick={() => onOpenItem(item)}
      >
        <span className={`line-clamp-2 font-semibold leading-snug text-ink-50 ${large ? 'text-[1.3rem]' : 'text-[1.03rem]'}`}>{item.productName}</span>
        {details.length > 0 && <span className={`mt-0.5 block leading-snug text-ink-300 ${large ? 'text-[1.05rem]' : 'text-[0.82rem]'}`}>{details.join(' · ')}</span>}
        {item.notes && <span className={`mt-0.5 block italic leading-snug text-ink-200 ${large ? 'text-[1.05rem]' : 'text-[0.82rem]'}`}>"{item.notes}"</span>}
        {kitchenLabel && <span className="mt-1 inline-block rounded bg-success-600/20 px-2 py-0.5 text-[10px] text-success-500">{kitchenLabel}</span>}
      </button>
      <span className={`flex-none font-semibold tabular-nums text-ink-50 ${large ? 'py-2.5 text-[1.3rem]' : 'py-[0.6rem] text-[1.03rem]'}`}>{formatRupiah(item.lineTotal)}</span>
    </div>
  )
}
