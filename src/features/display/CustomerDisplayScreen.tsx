import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { businessDisplayName, getSettings } from '@/db/repositories/settings'
import { formatRupiah } from '@/lib/currency'
import { activeCustomerDisplay, CUSTOMER_DISPLAY_KEY, readCustomerDisplay, type CustomerDisplayPointer } from '@/lib/customerDisplay'
import { discountLinesOf } from '@/lib/promos'

/** Layar "terima kasih" bertahan sekian sebelum kembali ke sambutan. */
const THANKS_MS = 30_000

/**
 * Layar pelanggan — jendela kedua di perangkat kasir, menghadap tamu. Mengikuti
 * pesanan yang diumumkan kasir (lihat lib/customerDisplay.ts) dan membaca isinya
 * langsung dari database lokal; tidak menjalankan sinkronisasi/cetak sendiri.
 */
export function CustomerDisplayScreen() {
  const [pointer, setPointer] = useState<CustomerDisplayPointer | null>(() => readCustomerDisplay())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CUSTOMER_DISPLAY_KEY) setPointer(readCustomerDisplay(e.newValue))
    }
    window.addEventListener('storage', onStorage)
    // Cadangan bila event `storage` tak terkirim (mis. jendela baru saja dipulihkan).
    const poll = setInterval(() => {
      setPointer(readCustomerDisplay())
      setNow(Date.now())
    }, 3000)
    return () => {
      window.removeEventListener('storage', onStorage)
      clearInterval(poll)
    }
  }, [])

  const settings = useLiveQuery(() => getSettings(), [])
  const active = activeCustomerDisplay(pointer, now)
  const orderId = active?.orderId ?? null
  const order = useLiveQuery(async () => (orderId ? ((await db.orders.get(orderId)) ?? null) : null), [orderId])
  const items = useLiveQuery(async () => (orderId ? (await db.orderItems.where('orderId').equals(orderId).sortBy('createdAt')).filter((i) => !i.voided && !i.removed) : []), [orderId]) ?? []
  const payments = useLiveQuery(async () => (orderId ? db.payments.where('orderId').equals(orderId).toArray() : []), [orderId]) ?? []

  const businessName = businessDisplayName(settings)
  const paid = !!order && (order.status === 'paid' || order.status === 'completed')
  const thanks = paid && !!active && now - Math.max(active.at, order.paidAt ?? 0) < THANKS_MS
  const showOrder = !!order && !paid && order.status !== 'void' && items.length > 0
  const change = payments.reduce((s, p) => s + (p.changeAmount ?? 0), 0)
  const showStaticQris = active?.stage === 'qris' && settings?.qrisProvider !== 'midtrans' && !!settings?.qrisImageDataUrl

  return (
    <div className="flex h-full w-full flex-col bg-ink-950 text-ink-50">
      <header className="flex flex-none items-center gap-4 border-b border-ink-800 px-8 py-5">
        {settings?.logoDataUrl && <img src={settings.logoDataUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />}
        <h1 className="font-display text-2xl font-bold">{businessName}</h1>
      </header>

      {thanks && order ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-5xl font-bold text-success-500">Terima kasih!</p>
          <p className="text-xl text-ink-200">Pembayaran {formatRupiah(order.grandTotal)} diterima.</p>
          {change > 0 && <p className="text-2xl font-semibold text-ink-50">Kembalian {formatRupiah(change)}</p>}
          {order.pointsEarned ? <p className="text-lg text-accent-500">+{order.pointsEarned} poin member</p> : null}
          <p className="mt-4 text-ink-300">Sampai jumpa kembali di {businessName}.</p>
        </main>
      ) : showOrder && order ? (
        <main className="flex min-h-0 flex-1 gap-8 p-8">
          <section className="flex min-w-0 flex-1 flex-col">
            <h2 className="mb-3 text-lg font-semibold text-ink-300">Pesanan Anda</h2>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 rounded-xl bg-ink-900 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-xl font-semibold">
                      {item.qty}× {item.productName}
                    </p>
                    {item.modifiers.length > 0 && <p className="text-sm text-ink-300">{item.modifiers.map((m) => m.optionName).join(', ')}</p>}
                    {item.notes && <p className="text-sm italic text-ink-400">{item.notes}</p>}
                  </div>
                  <p className="flex-none text-xl font-semibold tabular-nums">{formatRupiah(item.lineTotal)}</p>
                </div>
              ))}
            </div>
          </section>
          <aside className="flex w-[22rem] flex-none flex-col justify-end gap-2">
            {showStaticQris && (
              <div className="mb-4 rounded-2xl bg-white p-4 text-center">
                <img src={settings!.qrisImageDataUrl!} alt="QRIS" className="mx-auto max-h-72 w-full object-contain" />
                <p className="mt-2 text-sm font-semibold text-ink-950">
                  Pindai untuk membayar{settings?.qrisMerchantName ? ` • ${settings.qrisMerchantName}` : ''}
                </p>
              </div>
            )}
            {active?.stage === 'qris' && !showStaticQris && <p className="mb-4 rounded-2xl bg-ink-900 p-4 text-center text-lg text-ink-100">Silakan pindai kode QR yang ditunjukkan kasir.</p>}
            <Line label="Subtotal" value={order.subtotal} />
            {discountLinesOf(order).map((d) => (
              <Line key={d.label} label={d.label} value={-d.amount} tone="text-success-400" />
            ))}
            {order.serviceChargeAmount > 0 && <Line label="Service charge" value={order.serviceChargeAmount} />}
            {order.taxAmount > 0 && <Line label="Pajak" value={order.taxAmount} />}
            {order.roundingAdjustment !== 0 && <Line label="Pembulatan" value={order.roundingAdjustment} />}
            <div className="mt-2 flex items-baseline justify-between border-t border-ink-700 pt-4">
              <span className="text-xl text-ink-200">{active?.stage === 'qris' && active.amount ? 'Dibayar sekarang' : 'Total'}</span>
              <span className="text-5xl font-bold tabular-nums text-brand-400">{formatRupiah(active?.stage === 'qris' && active.amount ? active.amount : order.grandTotal)}</span>
            </div>
          </aside>
        </main>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          {settings?.logoDataUrl && <img src={settings.logoDataUrl} alt="" className="h-40 w-40 rounded-3xl object-cover" />}
          <p className="font-display text-5xl font-bold">Selamat datang</p>
          <p className="text-2xl text-ink-300">di {businessName}</p>
        </main>
      )}
    </div>
  )
}

function Line({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`flex justify-between text-lg ${tone ?? 'text-ink-200'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatRupiah(value)}</span>
    </div>
  )
}
