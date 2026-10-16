import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { retryPrintJob } from '@/db/repositories/printQueue'
import { useSessionStore } from '@/state/sessionStore'
import { getOrder } from '@/db/repositories/orders'
import { reprintKitchenTicket, sendOrderToKitchen } from '@/db/repositories/kitchenDispatch'
import { toast } from '@/state/toastStore'
import { prepareReceiptData } from '@/features/printing/printReceipt'
import { PrintPreviewModal } from '@/features/printing/PrintPreviewModal'
import { usePosStore } from '@/state/posStore'
import { getSettings } from '@/db/repositories/settings'
import { formatRupiah } from '@/lib/currency'
import { featuresForBusinessType } from '@/lib/businessType'
import { Icon } from '@/components/ui/Icon'
import { GuestRating } from '@/features/payments/GuestRating'
import { SendReceiptModal } from '@/features/payments/SendReceiptModal'
import { publishCustomerDisplay } from '@/lib/customerDisplay'
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
  const [showRating, setShowRating] = useState(false)
  const [proTools, setProTools] = useState(false)
  const [sendingReceipt, setSendingReceipt] = useState(false)
  const [hasKitchen, setHasKitchen] = useState(false)
  const [kitchenBusy, setKitchenBusy] = useState(false)
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
      setShowRating(featuresForBusinessType(settings.businessType).promos)
      setProTools(featuresForBusinessType(settings.businessType).proTools)
      setHasKitchen(featuresForBusinessType(settings.businessType).kitchen)
      if (settings.printerConfig.autoPrintOnPayment && !autoPrinted) {
        setAutoPrinted(true)
        setShowPreview(true)
      }
    })()
  }, [orderId, autoPrinted])

  // Layar pelanggan: tampilkan ucapan terima kasih.
  useEffect(() => {
    publishCustomerDisplay({ orderId, stage: 'paid' })
  }, [orderId])

  // Pesanan ini sudah lunas — lepas dari keranjang supaya membuka Kasir lewat menu
  // samping juga langsung siap untuk pesanan baru.
  useEffect(() => {
    if (usePosStore.getState().activeOrderId === orderId) setActiveOrderId(null)
  }, [orderId, setActiveOrderId])

  function handleNewTransaction() {
    setActiveOrderId(null)
    navigate('/kasir')
  }

  /** Kirim item yang belum ke dapur/bar; bila semua sudah terkirim, cetak ulang tiketnya. */
  async function handlePrintKitchen() {
    if (!order || !currentUser) return
    const actor = { userId: currentUser.id, userName: currentUser.name }
    setKitchenBusy(true)
    try {
      const res = await sendOrderToKitchen(order.id, actor)
      if (res.itemCount > 0) {
        toast.success(`${res.itemCount} item dikirim ke ${res.stations.join(', ') || 'dapur'}.`)
        return
      }
      const tickets = await db.kitchenTickets.where('orderId').equals(order.id).toArray()
      if (tickets.length === 0) {
        toast.error('Tidak ada item untuk dapur/bar pada pesanan ini.')
        return
      }
      for (const t of tickets) await reprintKitchenTicket(t.id, actor)
      toast.success(`Tiket dapur/bar dicetak ulang (${tickets.length}).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mencetak ke dapur/bar')
    } finally {
      setKitchenBusy(false)
    }
  }

  if (!order || !receipt) {
    return <div className="flex h-full items-center justify-center text-ink-400">Memuat...</div>
  }

  const receiptBusy = !!receiptJob && (receiptJob.status === 'QUEUED' || receiptJob.status === 'PRINTING')
  const bigBtn = 'flex min-h-[3.25rem] items-center justify-center rounded-lg px-4 text-[1.1rem] font-semibold text-white disabled:opacity-60'

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-[#fbfbfd] px-6 py-10 text-center">
      <div className="my-auto flex w-full max-w-[35rem] flex-col items-center">
        <div className="flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full border-[3px] border-[#2f8a1c] bg-[#d5e8d0] text-[#2f8a1c]">
          <Icon name="check" size={46} />
        </div>
        <h1 className="mt-4 text-[1.65rem] font-bold text-[#2f8a1c]">Pembayaran Berhasil</h1>
        {showQueue && order.queueNumber ? (
          <div className="mt-6 min-w-[11rem] rounded-2xl border-2 border-[#8d9be0] bg-white px-6 py-3">
            <p className="text-[1.05rem] tracking-wide text-ink-100">Nomor Antrean</p>
            <p className="mt-2 text-[2rem] font-medium leading-none text-ink-50">#{order.queueNumber}</p>
            {order.notes ? <p className="mt-2 text-base font-semibold text-ink-200">{order.notes}</p> : null}
          </div>
        ) : null}
        {order.pagerNumber != null && (
          <p className="mt-3 rounded-full bg-grape-600/10 px-4 py-1 text-sm font-semibold text-grape-400">Pager #{order.pagerNumber}</p>
        )}
        <p className="mt-6 text-[0.95rem] text-ink-50">Transaksi {order.orderNumber}</p>
        <p className="mt-2 text-[1.4rem] font-bold text-ink-50">{formatRupiah(order.grandTotal)}</p>

        {showRating && currentUser && (
          <div className="mt-4">
            <GuestRating orderId={order.id} actor={{ userId: currentUser.id, userName: currentUser.name }} />
          </div>
        )}

        <div className="mt-3 w-full">
          <ReceiptPrintStatus
            job={receiptJob}
            onRetry={() => receiptJob && currentUser && void retryPrintJob(receiptJob.id, { userId: currentUser.id, userName: currentUser.name })}
          />
        </div>

        <div className="mt-3 flex w-full flex-col gap-4">
          <div className={`grid gap-1.5 ${hasKitchen ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {hasKitchen && (
              <button className={`${bigBtn} bg-grape-600 hover:bg-grape-700`} disabled={kitchenBusy} onClick={() => void handlePrintKitchen()}>
                Cetak Struk ke Dapur/Bar
              </button>
            )}
            <button className={`${bigBtn} bg-royal-600 hover:bg-royal-700`} disabled={receiptBusy} onClick={() => setShowPreview(true)}>
              {receiptJob ? 'Cetak Ulang Struk Pelanggan' : 'Cetak Struk Pelanggan'}
            </button>
          </div>
          {proTools && currentUser && (
            <button className={`${bigBtn} bg-royal-600 hover:bg-royal-700`} onClick={() => setSendingReceipt(true)}>
              Kirim Struk via WhatsApp
            </button>
          )}
          <button
            className="flex min-h-[3.25rem] items-center justify-center rounded-lg border border-royal-600 bg-white text-[1.1rem] font-semibold text-royal-400 hover:bg-royal-600/5"
            onClick={handleNewTransaction}
          >
            Transaksi Baru
          </button>
        </div>
      </div>

      {sendingReceipt && currentUser && <SendReceiptModal order={order} actor={{ userId: currentUser.id, userName: currentUser.name }} onClose={() => setSendingReceipt(false)} />}

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
  const base = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm'
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
