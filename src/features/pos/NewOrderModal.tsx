import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listTables } from '@/db/repositories/tables'
import { searchCustomers } from '@/db/repositories/customers'
import type { CafeTable, Customer, OrderType } from '@/types/domain'

interface Props {
  onCancel: () => void
  onConfirm: (params: { type: OrderType; tableId?: string; customerId?: string; guestCount?: number }) => void
}

export function NewOrderModal({ onCancel, onConfirm }: Props) {
  const [type, setType] = useState<OrderType>('dine_in')
  const [tableId, setTableId] = useState<string | null>(null)
  const [guestCount, setGuestCount] = useState(2)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)

  const tables = useLiveQuery(() => listTables(), []) ?? []
  const customerResults = useLiveQuery(() => searchCustomers(customerQuery), [customerQuery]) ?? []

  const availableTables = tables.filter((t: CafeTable) => t.status === 'available')

  function handleConfirm() {
    if (type === 'dine_in' && !tableId) return
    onConfirm({
      type,
      tableId: type === 'dine_in' ? tableId! : undefined,
      customerId: customer?.id,
      guestCount: type === 'dine_in' ? guestCount : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Pesanan Baru</h2>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {(
            [
              ['dine_in', 'Dine-in'],
              ['takeaway', 'Takeaway'],
              ['delivery', 'Delivery'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setType(value)}
              className={`btn ${type === value ? 'btn-primary' : 'btn-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {type === 'dine_in' && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">Pilih Meja</h3>
            <div className="grid grid-cols-3 gap-2">
              {availableTables.map((table: CafeTable) => (
                <button
                  key={table.id}
                  onClick={() => setTableId(table.id)}
                  className={`btn ${tableId === table.id ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {table.name}
                </button>
              ))}
              {availableTables.length === 0 && <p className="col-span-3 text-sm text-ink-500">Tidak ada meja tersedia</p>}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-ink-300">Jumlah Tamu</span>
              <button className="btn-secondary !min-h-0 !px-3 !py-1.5" onClick={() => setGuestCount((g) => Math.max(1, g - 1))}>
                −
              </button>
              <span className="w-6 text-center font-bold">{guestCount}</span>
              <button className="btn-secondary !min-h-0 !px-3 !py-1.5" onClick={() => setGuestCount((g) => g + 1)}>
                +
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-300">Pelanggan (opsional)</h3>
          <input
            className="input-field"
            placeholder="Cari nama/telepon pelanggan"
            value={customer ? customer.name : customerQuery}
            onChange={(e) => {
              setCustomer(null)
              setCustomerQuery(e.target.value)
            }}
          />
          {customerQuery && !customer && customerResults.length > 0 && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-ink-700">
              {customerResults.map((c: Customer) => (
                <button
                  key={c.id}
                  className="block w-full px-3 py-2 text-left text-sm text-ink-200 hover:bg-ink-800"
                  onClick={() => {
                    setCustomer(c)
                    setCustomerQuery('')
                  }}
                >
                  {c.name} {c.phone && `• ${c.phone}`}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" disabled={type === 'dine_in' && !tableId} onClick={handleConfirm}>
            Mulai Pesanan
          </button>
        </div>
      </div>
    </div>
  )
}
