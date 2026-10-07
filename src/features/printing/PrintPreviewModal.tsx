import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activePrinterForStation } from '@/db/repositories/printers'
import { enqueueReceiptForOrder } from '@/db/repositories/receiptDispatch'
import { useSessionStore } from '@/state/sessionStore'
import { renderReceiptBodyHtml } from '@/features/printing/renderReceiptHtml'
import { printReceiptData, saveReceiptAsPdf } from '@/features/printing/printReceipt'
import { Modal } from '@/components/ui/Modal'
import type { ReceiptData } from '@/features/printing/receiptData'

interface Props {
  data: ReceiptData
  /**
   * Bila diisi dan printer kasir terpasang, "Cetak" masuk ANTREAN cetak sebagai
   * cetak ulang (tercatat di log, tak bertabrakan dengan struk otomatis yang
   * mungkin masih tercetak) — bukan mencetak langsung.
   */
  orderId?: string
  onClose: () => void
}

export function PrintPreviewModal({ data, orderId, onClose }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const currentUser = useSessionStore((s) => s.currentUser)
  const hasQueuedPrinter = useLiveQuery(async () => !!(await activePrinterForStation('cashier')), []) ?? false

  async function handlePrint() {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (orderId && hasQueuedPrinter && currentUser) {
        await enqueueReceiptForOrder(orderId, { userId: currentUser.id, userName: currentUser.name }, { isReprint: true })
        setInfo('Cetak ulang dikirim ke printer kasir.')
        return
      }
      await printReceiptData(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencetak struk')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-2xl bg-ink-900">
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
        {info && <p className="px-4 pb-2 text-sm text-success-500">{info}</p>}
        <div className="flex flex-none flex-col gap-2 border-t border-ink-800 p-4">
          <button className="btn-primary" disabled={busy} onClick={() => void handlePrint()}>
            {busy ? 'Mencetak...' : 'Cetak'}
          </button>
          <button className="btn-secondary" onClick={() => void saveReceiptAsPdf(data)}>
            Struk Digital (PDF)
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Tutup
          </button>
        </div>
    </Modal>
  )
}
