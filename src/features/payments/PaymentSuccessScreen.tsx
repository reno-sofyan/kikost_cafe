import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { retryPrintJob } from '@/db/repositories/printQueue'
import { useSessionStore } from '@/state/sessionStore'
import { getOrder } from '@/db/repositories/orders'
import { prepareReceiptData } from '@/features/printing/printReceipt'
import { PrintPreviewModal } from '@/features/printing/PrintPreviewModal'
import { usePosStore } from '@/state/posStore'
import { getSettings } from '@/db/repositories/settings'
import { formatRupiah } from '@/lib/currency'
import { featuresForBusinessType } from '@/lib/businessType'
import { Icon } from '@/components/ui/Icon'
import type { Order, PrintJob } from '@/types/domain'
import type { ReceiptData } from '@/features/printing/receiptData'

export function PaymentSuccessScreen({ orderId }: { orderId: string }) {
  const navigate = useNavigate()
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)
  const [order, setOrder] = useState<Order | null>(null)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [autoPrinted, setAutoPrinted] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const currentUser = useSessionStore((s) => s.currentUser)
  // Struk otomatis (lihat enqueueReceiptForOrder) — undefined = memuat, null = tak ada printer kasir.
  const receiptJob = useLiveQuery(async () => (await db.printJobs.get(`rc_${orderId}`)) ?? null, [orderId])

  useEffect(() => {
    void (async () => {
      const loadedOrder = await getOrder(orderId)
      if (!loadedOrder) return
      setOrder(loadedOrder)
      const data = await prepareReceiptData(loadedOrder)
      setReceipt(data)

      const settings = await getSettings()
      setShowQueue(featuresForBusinessType(settings.businessType).queueNumbers)
      if (settings.printerConfig.autoPrintOnPayment && !autoPrinted) {
        setAutoPrinted(true)
        setShowPreview(true)
      }
    })()
  }, [orderId, autoPrinted])

  function handleNewTransaction() {
    setActiveOrderId(null)
    navigate('/kasir')
  }

  if (!order || !receipt) {
    return <div className="flex h-full items-center justify-center text-ink-400">Memuat...</div>
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success-600/20 text-success-500">
        <Icon name="checkCircle" size={44} />
      </div>
      <h1 className="text-2xl font-bold text-ink-50">Pembayaran Berhasil</h1>
      {showQueue && order.queueNumber ? (
        <div className="rounded-2xl border border-brand-500/30 bg-brand-600/12 px-8 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Nomor Antrean</p>
          <p className="text-5xl font-bold text-ink-50">#{order.queueNumber}</p>
          {order.notes ? <p className="mt-1 text-lg font-semibold text-ink-200">{order.notes}</p> : null}
        </div>
      ) : null}
      <p className="text-ink-400">Transaksi {order.orderNumber}</p>
      <p className="text-3xl font-bold text-success-500">{formatRupiah(order.grandTotal)}</p>

      <ReceiptPrintStatus
        job={receiptJob}
        onRetry={() => receiptJob && currentUser && void retryPrintJob(receiptJob.id, { userId: currentUser.id, userName: currentUser.name })}
      />

      <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
        <button
          className="btn-primary"
          disabled={!!receiptJob && (receiptJob.status === 'QUEUED' || receiptJob.status === 'PRINTING')}
          onClick={() => setShowPreview(true)}
        >
          {receiptJob ? 'Cetak Ulang / Bagikan Struk' : 'Cetak / Pratinjau Struk'}
        </button>
        <button className="btn-secondary" onClick={handleNewTransaction}>
          Transaksi Baru
        </button>
      </div>

      {showPreview && <PrintPreviewModal data={receipt} orderId={order.id} onClose={() => setShowPreview(false)} />}
    </div>
  )
}

/**
 * Status struk otomatis — supaya kasir tak menekan "Cetak" lagi saat struk masih
 * menunggu printer (dulu menghasilkan struk dobel).
 */
function ReceiptPrintStatus({ job, onRetry }: { job: PrintJob | null | undefined; onRetry: () => void }) {
  if (!job) return null
  const base = 'flex w-full max-w-xs items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm'
  switch (job.status) {
    case 'QUEUED':
    case 'PRINTING':
      return <div className={`${base} bg-ink-800 text-ink-200`}>Mencetak struk…</div>
    case 'PRINTED':
      return (
        <div className={`${base} bg-success-600/15 text-success-500`}>
          <Icon name="checkCircle" size={16} /> Struk tercetak
        </div>
      )
    case 'RETRYING':
      return <div className={`${base} bg-yellow-900/20 text-yellow-300`}>Printer belum merespons — mencoba lagi otomatis…</div>
    default:
      return (
        <div className={`${base} flex-col bg-red-900/25 text-red-300`}>
          <span>Struk gagal dicetak{job.lastError ? `: ${job.lastError}` : ''}</span>
          <button className="btn-secondary !min-h-[2.5rem] !py-1.5 text-sm" onClick={onRetry}>
            Coba Cetak Lagi
          </button>
        </div>
      )
  }
}
