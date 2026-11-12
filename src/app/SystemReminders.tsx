import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listLowStockIngredients, listLowStockProducts } from '@/db/repositories/stock'
import { lowStockMessage, newlyLowStock, qrOrderReminder, type StockItemRef } from '@/lib/systemReminders'
import { notifySystemNow, SYSTEM_NOTIFICATION_IDS } from '@/native/systemNotify'

/**
 * Notifikasi sistem Android untuk pesanan QR baru & stok menipis (lihat systemReminders).
 * Tak merender apa pun; di web semua pengiriman dilewati. Pengingat shift ada di ShiftReminder.
 */
export function SystemReminders({ pendingQr }: { pendingQr: number }) {
  const prevQr = useRef<number | null>(null)
  useEffect(() => {
    const body = qrOrderReminder(prevQr.current, pendingQr, document.visibilityState === 'hidden')
    prevQr.current = pendingQr
    if (body) void notifySystemNow(SYSTEM_NOTIFICATION_IDS.qrOrder, 'Pesanan QR baru', body)
  }, [pendingQr])

  const low = useLiveQuery(async (): Promise<StockItemRef[]> => {
    const [products, ingredients] = await Promise.all([listLowStockProducts(), listLowStockIngredients()])
    return [...products.map((p) => ({ id: `p:${p.id}`, name: p.name })), ...ingredients.map((i) => ({ id: `i:${i.id}`, name: i.name }))]
  }, [])
  const prevLow = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!low) return
    const fresh = newlyLowStock(prevLow.current, low)
    prevLow.current = new Set(low.map((i) => i.id))
    if (fresh.length) void notifySystemNow(SYSTEM_NOTIFICATION_IDS.lowStock, 'Stok menipis', lowStockMessage(fresh))
  }, [low])

  return null
}
