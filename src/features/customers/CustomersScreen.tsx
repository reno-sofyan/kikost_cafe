import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCustomer, purchaseHistoryForCustomer, searchCustomers, updateCustomer } from '@/db/repositories/customers'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah } from '@/lib/currency'
import type { Customer } from '@/types/domain'

export function CustomersScreen() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [showForm, setShowForm] = useState(false)

  const customers = useLiveQuery(() => searchCustomers(search), [search]) ?? []
  const history = useLiveQuery(() => (selected ? purchaseHistoryForCustomer(selected.id) : []), [selected?.id]) ?? []

  return (
    <div className="flex h-full">
      <div className="flex w-96 flex-none flex-col border-r border-ink-800">
        <div className="flex-none border-b border-ink-800 p-4">
          <h1 className="mb-3 text-xl font-bold text-ink-50">Pelanggan</h1>
          <input className="input-field mb-2" placeholder="Cari nama/telepon" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-primary w-full" onClick={() => setShowForm(true)}>
            + Pelanggan Baru
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {customers.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`mb-2 block w-full rounded-xl p-3 text-left ${selected?.id === c.id ? 'bg-brew-600/20 border border-brew-600' : 'bg-ink-900 border border-ink-800'}`}
            >
              <p className="font-semibold text-ink-50">{c.name}</p>
              <p className="text-sm text-ink-400">{c.phone}</p>
            </button>
          ))}
          {customers.length === 0 && <p className="text-center text-sm text-ink-500">Belum ada pelanggan</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <p className="text-ink-500">Pilih pelanggan untuk melihat detail</p>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-ink-50">{selected.name}</h2>
                <p className="text-ink-400">{selected.phone}</p>
              </div>
              <button className="btn-secondary" onClick={() => setShowForm(true)}>
                Edit
              </button>
            </div>
            {selected.note && <p className="mb-4 rounded-xl bg-ink-900 p-3 text-sm text-ink-300">{selected.note}</p>}

            <h3 className="mb-2 font-semibold text-ink-100">Riwayat Pembelian</h3>
            <div className="space-y-2">
              {history.map((order) => (
                <div key={order.id} className="card flex justify-between p-3">
                  <div>
                    <p className="font-medium text-ink-50">{order.orderNumber}</p>
                    <p className="text-xs text-ink-400">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <p className="font-bold text-brew-400">{formatRupiah(order.grandTotal)}</p>
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-ink-500">Belum ada transaksi</p>}
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <CustomerFormModal
          initial={selected}
          onClose={() => setShowForm(false)}
          onSaved={(c) => {
            setSelected(c)
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function CustomerFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Customer | null
  onClose: () => void
  onSaved: (c: Customer) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [note, setNote] = useState(initial?.note ?? '')

  async function handleSave() {
    if (!name.trim()) return
    if (initial) {
      await updateCustomer(initial.id, { name, phone, note })
      onSaved({ ...initial, name, phone, note })
    } else {
      const created = await createCustomer({ name, phone, note })
      onSaved(created)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Pelanggan' : 'Pelanggan Baru'}</h2>
        <input className="input-field mb-3" placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input-field mb-3" placeholder="Telepon" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <textarea className="input-field mb-4" placeholder="Catatan" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void handleSave()}>
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
