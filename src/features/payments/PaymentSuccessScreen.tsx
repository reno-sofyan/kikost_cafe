import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOrder } from '@/db/repositories/orders'
import { prepareReceiptData } from '@/features/printing/printReceipt'
import { PrintPreviewModal } from '@/features/printing/PrintPreviewModal'
import { usePosStore } from '@/state/posStore'
import { getSettings } from '@/db/repositories/settings'
import { formatRupiah } from '@/lib/currency'
import { Icon } from '@/components/ui/Icon'
import type { Order } from '@/types/domain'
import type { ReceiptData } from '@/features/printing/receiptData'

export function PaymentSuccessScreen({ orderId }: { orderId: string }) {
  const navigate = useNavigate()
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)
  const [order, setOrder] = useState<Order | null>(null)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [autoPrinted, setAutoPrinted] = useState(false)

  useEffect(() => {
    void (async () => {
      const loadedOrder = await getOrder(orderId)
      if (!loadedOrder) return
      setOrder(loadedOrder)
      const data = await prepareReceiptData(loadedOrder)
      setReceipt(data)

      const settings = await getSettings()
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
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sage-600/20 text-sage-500">
        <Icon name="checkCircle" size={44} />
      </div>
      <h1 className="text-2xl font-bold text-ink-50">Pembayaran Berhasil</h1>
      <p className="text-ink-400">Transaksi {order.orderNumber}</p>
      <p className="text-3xl font-bold text-sage-500">{formatRupiah(order.grandTotal)}</p>

      <div className="mt-4 flex w-full max-w-xs flex-col gap-3">
        <button className="btn-primary" onClick={() => setShowPreview(true)}>
          Cetak / Pratinjau Struk
        </button>
        <button className="btn-secondary" onClick={handleNewTransaction}>
          Transaksi Baru
        </button>
      </div>

      {showPreview && <PrintPreviewModal order={order} data={receipt} onClose={() => setShowPreview(false)} />}
    </div>
  )
}
