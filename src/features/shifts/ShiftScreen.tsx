import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addCashMovement,
  buildShiftSummary,
  closeShift,
  getOpenShift,
  listCashMovements,
  openShift,
} from '@/db/repositories/shifts'
import { useSessionStore } from '@/state/sessionStore'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import { printShiftReport } from '@/features/shifts/printShiftReport'

export function ShiftScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const openShiftData = useLiveQuery(() => getOpenShift(), [])
  const movements = useLiveQuery(() => (openShiftData ? listCashMovements(openShiftData.id) : []), [openShiftData?.id]) ?? []

  const [showOpenForm, setShowOpenForm] = useState(false)
  const [showCashMovement, setShowCashMovement] = useState<'in' | 'out' | null>(null)
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (openShiftData === undefined) {
    return <div className="flex h-full items-center justify-center text-ink-400">Memuat...</div>
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-xl font-bold text-ink-50">Shift Kasir</h1>

      {!openShiftData ? (
        <div className="card mx-auto max-w-sm p-6 text-center">
          <Icon name="cashDrawer" size={40} className="mx-auto mb-3 text-ink-400" />
          <p className="mb-4 text-ink-400">Belum ada shift yang berjalan</p>
          <button className="btn-primary w-full" onClick={() => setShowOpenForm(true)}>
            Buka Shift
          </button>
        </div>
      ) : (
        <div className="mx-auto max-w-lg space-y-4">
          <div className="card p-5">
            <p className="text-sm text-ink-400">Kasir: {openShiftData.cashierName}</p>
            <p className="text-sm text-ink-400">Dibuka: {formatDateTime(openShiftData.openedAt)}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-ink-300">Modal Awal</span>
              <span className="font-semibold text-ink-50">{formatRupiah(openShiftData.openingCash)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-ink-300">Kas Seharusnya Saat Ini</span>
              <span className="font-bold text-brew-400">{formatRupiah(openShiftData.expectedCash)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secondary" onClick={() => setShowCashMovement('in')}>
              Kas Masuk
            </button>
            <button className="btn-secondary" onClick={() => setShowCashMovement('out')}>
              Kas Keluar
            </button>
          </div>

          <div className="card p-4">
            <h3 className="mb-2 font-semibold text-ink-100">Riwayat Kas Manual</h3>
            {movements.length === 0 && <p className="text-sm text-ink-500">Belum ada kas masuk/keluar</p>}
            {movements.map((m) => (
              <div key={m.id} className="flex justify-between border-b border-ink-800 py-1.5 text-sm last:border-0">
                <span className="text-ink-300">{m.reason}</span>
                <span className={m.type === 'in' ? 'text-sage-500' : 'text-red-400'}>
                  {m.type === 'in' ? '+' : '-'}
                  {formatRupiah(m.amount)}
                </span>
              </div>
            ))}
          </div>

          <button className="btn-danger w-full" onClick={() => setShowCloseForm(true)}>
            Tutup Shift
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-center text-sm text-red-400">{error}</p>}

      {showOpenForm && (
        <OpenShiftModal
          onClose={() => setShowOpenForm(false)}
          onConfirm={async (openingCash) => {
            await openShift({ cashierId: currentUser.id, cashierName: currentUser.name, openingCash })
            setShowOpenForm(false)
          }}
        />
      )}

      {showCashMovement && openShiftData && (
        <CashMovementModal
          type={showCashMovement}
          onClose={() => setShowCashMovement(null)}
          onConfirm={async (amount, reason) => {
            await addCashMovement({ shiftId: openShiftData.id, type: showCashMovement, amount, reason, userId: currentUser.id })
            setShowCashMovement(null)
          }}
        />
      )}

      {showCloseForm && openShiftData && (
        <CloseShiftModal
          shiftId={openShiftData.id}
          expectedCash={openShiftData.expectedCash}
          onClose={() => setShowCloseForm(false)}
          onError={setError}
        />
      )}
    </div>
  )
}

function OpenShiftModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (openingCash: number) => Promise<void> }) {
  const [amount, setAmount] = useState(0)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Buka Shift</h2>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Modal Awal</span>
          <input className="input-field" inputMode="numeric" value={formatRupiah(amount)} onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
        </label>
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void onConfirm(amount)}>
            Buka Shift
          </button>
        </div>
      </div>
    </div>
  )
}

function CashMovementModal({
  type,
  onClose,
  onConfirm,
}: {
  type: 'in' | 'out'
  onClose: () => void
  onConfirm: (amount: number, reason: string) => Promise<void>
}) {
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{type === 'in' ? 'Kas Masuk' : 'Kas Keluar'}</h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Jumlah</span>
          <input className="input-field" inputMode="numeric" value={formatRupiah(amount)} onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Keterangan</span>
          <input className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" disabled={amount <= 0} onClick={() => void onConfirm(amount, reason)}>
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}

function CloseShiftModal({
  shiftId,
  expectedCash,
  onClose,
  onError,
}: {
  shiftId: string
  expectedCash: number
  onClose: () => void
  onError: (message: string | null) => void
}) {
  const [actualCash, setActualCash] = useState(expectedCash)
  const [notes, setNotes] = useState('')
  const variance = actualCash - expectedCash

  async function handleClose() {
    onError(null)
    try {
      const summary = await buildShiftSummaryAfterClose(shiftId, actualCash, notes)
      printShiftReport(summary)
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Gagal menutup shift')
    }
  }

  async function buildShiftSummaryAfterClose(id: string, actual: number, note: string) {
    const closed = await closeShift({ shiftId: id, closingCashActual: actual, notes: note })
    return buildShiftSummary(closed.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Tutup Shift</h2>
        <p className="mb-3 text-sm text-ink-400">Kas seharusnya: {formatRupiah(expectedCash)}</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Kas Aktual (hasil hitung fisik)</span>
          <input
            className="input-field"
            inputMode="numeric"
            value={formatRupiah(actualCash)}
            onChange={(e) => setActualCash(parseRupiahInput(e.target.value))}
          />
        </label>
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${variance === 0 ? 'bg-sage-600/20 text-sage-500' : 'bg-red-900/30 text-red-400'}`}>
          Selisih: {formatRupiah(variance)}
        </div>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Catatan (opsional)</span>
          <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-danger flex-[2]" onClick={() => void handleClose()}>
            Tutup Shift &amp; Cetak Laporan
          </button>
        </div>
      </div>
    </div>
  )
}
