import { COURSE_LABELS } from '@/lib/courses'
import { formatRupiah } from '@/lib/currency'
import { modifiersTotal } from '@/lib/orderTotals'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { OrderItem } from '@/types/domain'

/**
 * Detail satu item keranjang (tap nama item): catatan, urutan saji, dan hapus item —
 * aksi yang dulu tampil di setiap kartu item. Perubahan jumlah tetap lewat stepper.
 */
export function OrderItemSheet({
  item,
  courseMode,
  heldCourse,
  onClose,
  onEditNote,
  onCycleCourse,
  onRemove,
}: {
  item: OrderItem
  courseMode: boolean
  heldCourse: number | null
  onClose: () => void
  onEditNote: () => void
  onCycleCourse: () => void
  onRemove: () => void
}) {
  // Sama dengan aturan lama tombol "Tambah catatan": hanya sebelum diteruskan ke dapur.
  const noteEditable = item.skipKitchen || (item.kitchenStatus === 'new' && item.kitchenPrintedAt == null)
  const showCourse = courseMode && !item.skipKitchen
  return (
    <Modal onClose={onClose} align="bottom" className="w-full max-w-md rounded-t-2xl bg-ink-900 p-5 sm:rounded-2xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-snug text-ink-50">{item.productName}</h2>
          <p className="text-sm text-ink-300">
            {item.qty} × {formatRupiah(item.unitPrice + modifiersTotal(item.modifiers))}
            {item.discountAmount > 0 ? ` − diskon ${formatRupiah(item.discountAmount)}` : ''}
          </p>
        </div>
        <span className="flex-none text-lg font-bold text-ink-50">{formatRupiah(item.lineTotal)}</span>
      </div>
      {(item.modifiers.length > 0 || item.notes) && (
        <div className="mb-3 space-y-0.5 rounded-xl bg-ink-800 px-3 py-2 text-sm">
          {item.modifiers.map((m) => (
            <p key={m.optionId} className="text-ink-200">
              {m.groupName} : {m.optionName}
              {m.priceDelta > 0 ? ` (+${formatRupiah(m.priceDelta)})` : ''}
            </p>
          ))}
          {item.notes && <p className="italic text-ink-200">"{item.notes}"</p>}
        </div>
      )}
      {!item.skipKitchen && item.kitchenStatus !== 'new' && <p className="mb-3 text-sm text-success-500">Dapur: {item.kitchenStatus}</p>}
      <div className="space-y-2">
        {noteEditable && (
          <Button variant="secondary" fullWidth aria-label={`${item.notes ? 'Ubah' : 'Tambah'} catatan ${item.productName}`} onClick={onEditNote}>
            {item.notes ? 'Ubah catatan' : 'Tambah catatan'}
          </Button>
        )}
        {showCourse && (
          <Button variant="secondary" fullWidth disabled={item.kitchenPrintedAt != null} aria-label={`Urutan saji ${item.productName}`} onClick={onCycleCourse}>
            Urutan Saji : {item.course ? COURSE_LABELS[item.course] : '-'}
            {item.course && item.kitchenPrintedAt == null && heldCourse != null && item.course > heldCourse ? ' • ditahan' : ''}
          </Button>
        )}
        <Button variant="ghost" fullWidth className="text-red-400 hover:bg-red-900/10 hover:text-red-300" onClick={onRemove}>
          Hapus item
        </Button>
      </div>
    </Modal>
  )
}
