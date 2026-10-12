import { useEffect, useState } from 'react'
import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { prepareReceiptData } from '@/features/printing/printReceipt'
import { receiptToText } from '@/lib/receiptText'
import { waLink } from '@/lib/whatsapp'
import { Modal } from '@/components/ui/Modal'
import type { Order } from '@/types/domain'

/** Kirim struk sebagai pesan WhatsApp: membuka WhatsApp dengan struk siap kirim ke nomor tamu. */
export function SendReceiptModal({ order, actor, onClose }: { order: Order; actor: { userId: string; userName: string }; onClose: () => void }) {
  const [phone, setPhone] = useState(order.customerPhone ?? '')
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [data, customer] = await Promise.all([prepareReceiptData(order, { isReprint: false }), order.customerId ? db.customers.get(order.customerId) : undefined])
      if (cancelled) return
      setText(receiptToText(data))
      // Nomor member dipakai bila pesanan belum membawa nomor (pesanan QR sudah punya).
      if (customer?.phone && !customer.giftCard) setPhone((current) => current || customer.phone)
    })()
    return () => {
      cancelled = true
    }
  }, [order])

  const link = text ? waLink(phone, text) : null

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Kirim Struk via WhatsApp</h2>
      <p className="mb-3 text-sm text-ink-400">WhatsApp terbuka dengan struk {order.orderNumber} siap dikirim. Anda tinggal menekan kirim.</p>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Nomor WhatsApp tamu</span>
        <input className="input-field" inputMode="tel" autoFocus placeholder="08xxxxxxxxxx" aria-label="Nomor WhatsApp tamu" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {text && <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-800 p-3 text-xs text-ink-200">{text}</pre>}
      {phone.trim() && !link && text && <p className="mb-2 text-sm text-red-400">Nomor tidak valid.</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Tutup
        </button>
        {link ? (
          <a
            className="btn-primary flex-[2] text-center"
            href={link}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              void recordAuditLog({ ...actor, action: 'receipt.whatsapp', entityType: 'order', entityId: order.id, details: `Struk ${order.orderNumber} dibuka di WhatsApp untuk dikirim ke tamu.` })
              onClose()
            }}
          >
            Buka WhatsApp
          </a>
        ) : (
          <button className="btn-primary flex-[2]" disabled>
            Buka WhatsApp
          </button>
        )}
      </div>
    </Modal>
  )
}
