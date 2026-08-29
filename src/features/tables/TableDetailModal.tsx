import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getOrder, mergeOrders } from '@/db/repositories/orders'
import { listTables, markAvailable, markNeedsCleaning, moveTable, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { formatRupiah } from '@/lib/currency'
import { durationSince } from '@/lib/datetime'
import type { CafeTable } from '@/types/domain'

interface Props {
  table: CafeTable
  onClose: () => void
  onOpenInCashier: (orderId: string) => void
}

export function TableDetailModal({ table, onClose, onOpenInCashier }: Props) {
  const [mode, setMode] = useState<'default' | 'move' | 'merge'>('default')
  const order = useLiveQuery(() => (table.currentOrderId ? getOrder(table.currentOrderId) : undefined), [table.currentOrderId])
  const allTables = useLiveQuery(() => listTables(), []) ?? []

  const otherAvailable = allTables.filter((t) => t.id !== table.id && t.status === 'available')
  const otherOccupied = allTables.filter((t) => t.id !== table.id && t.currentOrderId && (t.status === 'occupied' || t.status === 'awaiting_payment'))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink-50">{table.name}</h2>
          <span className="text-sm text-ink-400">{TABLE_STATUS_LABELS[table.status]}</span>
        </div>

        {mode === 'default' && (
          <div className="space-y-3">
            {table.occupiedSince && <p className="text-sm text-ink-400">Lama pemakaian: {durationSince(table.occupiedSince, Date.now())}</p>}
            {table.guestCount && <p className="text-sm text-ink-400">{table.guestCount} tamu</p>}
            {order && (
              <p className="text-lg font-bold text-brew-400">
                {order.orderNumber} • {formatRupiah(order.grandTotal)}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {order && (
                <button className="btn-primary" onClick={() => onOpenInCashier(order.id)}>
                  Buka di Kasir
                </button>
              )}
              {(table.status === 'occupied' || table.status === 'awaiting_payment') && (
                <>
                  <button className="btn-secondary" onClick={() => setMode('move')}>
                    Pindah Meja
                  </button>
                  <button className="btn-secondary" onClick={() => setMode('merge')}>
                    Gabungkan Tagihan
                  </button>
                </>
              )}
              {table.status === 'needs_cleaning' && (
                <button
                  className="btn-primary"
                  onClick={() => {
                    void markAvailable(table.id)
                    onClose()
                  }}
                >
                  Tandai Tersedia
                </button>
              )}
              {table.status === 'awaiting_payment' && (
                <button
                  className="btn-ghost"
                  onClick={() => {
                    void markNeedsCleaning(table.id)
                    onClose()
                  }}
                >
                  Tandai Perlu Dibersihkan
                </button>
              )}
              <button className="btn-ghost" onClick={onClose}>
                Tutup
              </button>
            </div>
          </div>
        )}

        {mode === 'move' && (
          <div>
            <p className="mb-3 text-sm text-ink-400">Pilih meja tujuan</p>
            <div className="grid grid-cols-3 gap-2">
              {otherAvailable.map((t) => (
                <button
                  key={t.id}
                  className="btn-secondary"
                  onClick={() => {
                    void moveTable(table.id, t.id)
                    onClose()
                  }}
                >
                  {t.name}
                </button>
              ))}
              {otherAvailable.length === 0 && <p className="col-span-3 text-sm text-ink-500">Tidak ada meja tersedia</p>}
            </div>
            <button className="btn-ghost mt-4 w-full" onClick={() => setMode('default')}>
              Kembali
            </button>
          </div>
        )}

        {mode === 'merge' && (
          <div>
            <p className="mb-3 text-sm text-ink-400">Gabungkan tagihan meja lain ke {table.name}</p>
            <div className="space-y-2">
              {otherOccupied.map((t) => (
                <button
                  key={t.id}
                  className="btn-secondary w-full"
                  onClick={() => {
                    if (order && t.currentOrderId) {
                      void mergeOrders(order.id, t.currentOrderId)
                    }
                    onClose()
                  }}
                >
                  {t.name}
                </button>
              ))}
              {otherOccupied.length === 0 && <p className="text-sm text-ink-500">Tidak ada meja terisi lain</p>}
            </div>
            <button className="btn-ghost mt-4 w-full" onClick={() => setMode('default')}>
              Kembali
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
