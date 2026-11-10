import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listSavedNotas } from '@/db/repositories/retail'
import { prepareReceiptData, saveReceiptAsPdf } from '@/features/printing/printReceipt'
import { PrintPreviewModal } from '@/features/printing/PrintPreviewModal'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah } from '@/lib/currency'
import { toast } from '@/state/toastStore'
import type { ReceiptData } from '@/features/printing/receiptData'
import type { Order } from '@/types/domain'

/** Laporan → Nota Tersimpan (minimarket): nota yang ditandai "Simpan nota ke Laporan" saat bayar. */
export function SavedNotasSection({ range }: { range: { from: number; to: number } }) {
  const notas = useLiveQuery(() => listSavedNotas(range.from, range.to + 1), [range.from, range.to]) ?? []
  const [preview, setPreview] = useState<{ order: Order; data: ReceiptData } | null>(null)

  async function exportPdf(order: Order) {
    try {
      await saveReceiptAsPdf(await prepareReceiptData(order, { isReprint: true }))
    } catch {
      toast.error('Nota PDF gagal dibuat')
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-semibold text-ink-50">Nota Tersimpan</h3>
        <span className="text-sm text-ink-300">
          {notas.length} nota · {formatRupiah(notas.reduce((s, o) => s + o.grandTotal, 0))}
        </span>
      </div>
      {notas.length === 0 ? (
        <p className="text-sm text-ink-300">Belum ada nota tersimpan di periode ini. Aktifkan "Simpan nota ke Laporan" di layar pembayaran.</p>
      ) : (
        <div className="max-h-80 divide-y divide-ink-700 overflow-y-auto text-sm">
          {notas.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-ink-50">{o.orderNumber}</p>
                <p className="text-xs text-ink-300">
                  {formatDateTime(o.paidAt ?? o.createdAt)}
                  {o.status === 'void' ? ' · dibatalkan' : ''}
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className="mr-2 font-semibold text-ink-50">{formatRupiah(o.grandTotal)}</span>
                <button className="btn-secondary !min-h-[2.5rem] !px-3 text-xs" onClick={() => void prepareReceiptData(o, { isReprint: true }).then((data) => setPreview({ order: o, data }))}>
                  Lihat
                </button>
                <button className="btn-secondary !min-h-[2.5rem] !px-3 text-xs" onClick={() => void exportPdf(o)}>
                  PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {preview && <PrintPreviewModal data={preview.data} orderId={preview.order.id} onClose={() => setPreview(null)} />}
    </div>
  )
}
