import { useState } from 'react'
import { renderReceiptBodyHtml } from '@/features/printing/renderReceiptHtml'
import { printOrderReceipt, saveReceiptAsPdf } from '@/features/printing/printReceipt'
import type { ReceiptData } from '@/features/printing/receiptData'
import type { Order } from '@/types/domain'

interface Props {
  order: Order
  data: ReceiptData
  onClose: () => void
}

export function PrintPreviewModal({ order, data, onClose }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handlePrint() {
    setBusy(true)
    setError(null)
    try {
      await printOrderReceipt(order)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencetak struk')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-2xl bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex-none border-b border-ink-800 px-4 py-3">
          <h2 className="font-bold text-ink-50">Pratinjau Struk</h2>
        </div>
        <div className="flex-1 overflow-y-auto bg-white p-4">
          <div
            className="mx-auto font-mono text-[11px] text-black"
            style={{ width: data.paperSize === '58mm' ? '54mm' : '76mm' }}
            dangerouslySetInnerHTML={{ __html: `<style>.row{display:flex;justify-content:space-between;gap:6px}.center{text-align:center}.bold{font-weight:700}.big{font-size:13px}.sub{padding-left:8px;font-size:10px;color:#333}hr{border:none;border-top:1px dashed #000;margin:4px 0}</style>${renderReceiptBodyHtml(data)}` }}
          />
        </div>
        {error && <p className="px-4 pb-2 text-sm text-red-400">{error}</p>}
        <div className="flex flex-none flex-col gap-2 border-t border-ink-800 p-4">
          <button className="btn-primary" disabled={busy} onClick={() => void handlePrint()}>
            {busy ? 'Mencetak...' : 'Cetak'}
          </button>
          <button className="btn-secondary" onClick={() => saveReceiptAsPdf(data)}>
            Simpan PDF
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}
