import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createExpense, EXPENSE_CATEGORIES, listExpenses } from '@/db/repositories/expenses'
import { getOpenShift } from '@/db/repositories/shifts'
import { useSessionStore } from '@/state/sessionStore'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ExpensesScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const openShift = useLiveQuery(() => getOpenShift(), [])
  const expenses = useLiveQuery(() => listExpenses(), []) ?? []
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-50">Pengeluaran</h1>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Catat Pengeluaran
        </button>
      </div>

      <div className="space-y-2">
        {expenses.map((expense) => (
          <div key={expense.id} className="card flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              {expense.photoDataUrl && <img src={expense.photoDataUrl} alt="Bukti" className="h-12 w-12 rounded-lg object-cover" />}
              <div>
                <p className="font-semibold text-ink-50">{expense.category}</p>
                <p className="text-sm text-ink-400">{expense.note}</p>
                <p className="text-xs text-ink-500">{formatDateTime(expense.createdAt)}</p>
              </div>
            </div>
            <p className="font-bold text-red-400">-{formatRupiah(expense.amount)}</p>
          </div>
        ))}
        {expenses.length === 0 && <p className="text-center text-ink-500">Belum ada pengeluaran tercatat</p>}
      </div>

      {showForm && (
        <ExpenseFormModal
          shiftId={openShift?.id ?? null}
          userId={currentUser.id}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

function ExpenseFormModal({ shiftId, userId, onClose }: { shiftId: string | null; userId: string; onClose: () => void }) {
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0])
  const [amount, setAmount] = useState(0)
  const [note, setNote] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (amount <= 0) {
      setError('Jumlah pengeluaran tidak valid')
      return
    }
    await createExpense({ category, amount, note, photoDataUrl, shiftId, userId })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Catat Pengeluaran</h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Kategori</span>
          <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Jumlah</span>
          <input className="input-field" inputMode="numeric" value={formatRupiah(amount)} onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Catatan</span>
          <textarea className="input-field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Bukti Foto (opsional)</span>
          <input
            type="file"
            accept="image/*"
            className="text-sm text-ink-300"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) setPhotoDataUrl(await readFileAsDataUrl(file))
            }}
          />
        </label>
        {!shiftId && <p className="mb-3 text-xs text-yellow-400">Tidak ada shift aktif, pengeluaran tidak akan tercatat di laporan shift manapun.</p>}
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
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
