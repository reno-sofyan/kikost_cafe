import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCustomer, purchaseHistoryForCustomer, searchCustomers, updateCustomer } from '@/db/repositories/customers'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { adjustCustomerPoints, listCustomerLoyalty } from '@/db/repositories/loyalty'
import { DEPOSIT_TOPUP_METHODS, depositEnabledFor, listCustomerDeposits, recordCustomerDeposit } from '@/db/repositories/deposits'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { loyaltySettingsOf } from '@/lib/loyalty'
import { isBirthdayAt } from '@/lib/promos'
import { roleHasPermission } from '@/lib/permissions'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import type { Customer, PaymentMethod } from '@/types/domain'

export function CustomersScreen() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [showForm, setShowForm] = useState(false)

  const customers = useLiveQuery(() => searchCustomers(search), [search]) ?? []
  const history = useLiveQuery(() => (selected ? purchaseHistoryForCustomer(selected.id) : []), [selected?.id]) ?? []
  const currentUser = useSessionStore((s) => s.currentUser)!
  const settings = useLiveQuery(() => getSettings(), [])
  const loyalty = settings ? loyaltySettingsOf(settings) : null
  const memberOn = !!settings && featuresForBusinessType(settings.businessType).loyalty && !!loyalty?.enabled
  const loyaltyByCustomer = useLiveQuery(() => listCustomerLoyalty(), [])
  const info = selected ? loyaltyByCustomer?.get(selected.id) : undefined
  const [showAdjust, setShowAdjust] = useState(false)
  const depositOn = !!settings && depositEnabledFor(settings)
  const deposits = useLiveQuery(() => listCustomerDeposits(), [])
  const deposit = selected ? deposits?.get(selected.id) : undefined
  const [showDeposit, setShowDeposit] = useState(false)
  const canManage = roleHasPermission(currentUser.role, 'settings.manage')

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
              className={`mb-2 block w-full rounded-xl p-3 text-left ${selected?.id === c.id ? 'bg-brand-600/20 border border-brand-600' : 'bg-ink-900 border border-ink-800'}`}
            >
              <p className="font-semibold text-ink-50">{c.name}</p>
              <p className="text-sm text-ink-400">
                {c.phone}
                {memberOn && loyaltyByCustomer?.get(c.id) ? ` • ${loyaltyByCustomer.get(c.id)!.tier.name} • ${formatNumber(loyaltyByCustomer.get(c.id)!.balance)} poin` : ''}
                {depositOn && (deposits?.get(c.id)?.balance ?? 0) > 0 ? ` • saldo ${formatRupiah(deposits!.get(c.id)!.balance)}` : ''}
              </p>
            </button>
          ))}
          {customers.length === 0 && <p className="text-center text-sm text-ink-500">Belum ada pelanggan</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Icon name="user" size={40} className="text-ink-400" />
            <p className="text-ink-400">Pilih pelanggan untuk melihat detail</p>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-ink-50">{selected.name}</h2>
                <p className="text-ink-400">
                  {selected.phone}
                  {selected.birthDate ? `${selected.phone ? ' • ' : ''}Lahir ${formatDate(new Date(`${selected.birthDate}T00:00:00+07:00`).getTime())}` : ''}
                  {isBirthdayAt(selected.birthDate, Date.now(), 'month') && <span className="ml-2 rounded-full bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-500">Ulang tahun bulan ini</span>}
                </p>
              </div>
              <button className="btn-secondary" onClick={() => setShowForm(true)}>
                Edit
              </button>
            </div>
            {selected.note && <p className="mb-4 rounded-xl bg-ink-900 p-3 text-sm text-ink-300">{selected.note}</p>}

            {memberOn && info && loyalty && (
              <div className="mb-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="card p-4">
                    <p className="text-xs text-ink-300">Tingkatan</p>
                    <p className="mt-1 text-lg font-bold text-ink-50">{info.tier.name}</p>
                    <p className="text-xs text-ink-300">Poin ×{info.tier.multiplier}</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs text-ink-300">Saldo Poin</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-ink-50">{formatNumber(info.balance)}</p>
                    <p className="text-xs text-ink-300">senilai {formatRupiah(info.balance * loyalty.pointValue)}</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs text-ink-300">Total Belanja</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-ink-50">{formatRupiah(info.lifetimeSpend)}</p>
                    <p className="text-xs text-ink-300">{formatNumber(info.transactionCount)} transaksi</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs text-ink-300">Poin Didapat / Ditukar</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-ink-50">
                      {formatNumber(info.earned)} / {formatNumber(info.redeemed)}
                    </p>
                    {info.adjustment !== 0 && <p className="text-xs text-ink-300">koreksi {info.adjustment > 0 ? '+' : ''}{formatNumber(info.adjustment)}</p>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-300">
                  <span>
                    {info.nextTier
                      ? `Belanja ${formatRupiah(info.nextTier.remaining)} lagi untuk naik ke ${info.nextTier.tier.name}.`
                      : 'Sudah di tingkatan tertinggi.'}
                    {info.nextExpiry ? ` ${formatNumber(info.nextExpiry.points)} poin hangus pada ${formatDate(info.nextExpiry.at)}.` : ''}
                    {info.expired > 0 ? ` Sudah hangus: ${formatNumber(info.expired)} poin.` : ''}
                  </span>
                  {canManage && (
                    <button className="btn-secondary btn-compact !px-3 text-sm" onClick={() => setShowAdjust(true)}>
                      Koreksi Poin
                    </button>
                  )}
                </div>
              </div>
            )}

            {depositOn && deposit && (
              <div className="card mb-5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-ink-300">Saldo Member</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-ink-50">{formatRupiah(deposit.balance)}</p>
                    <p className="text-xs text-ink-300">
                      diisi {formatRupiah(deposit.toppedUp)} • dipakai {formatRupiah(deposit.spent)}
                      {deposit.withdrawn > 0 ? ` • ditarik ${formatRupiah(deposit.withdrawn)}` : ''}
                    </p>
                  </div>
                  <button className="btn-primary" onClick={() => setShowDeposit(true)}>
                    Isi Saldo
                  </button>
                </div>
                {deposit.entries.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-ink-800 pt-3 text-sm">
                    {deposit.entries.slice(0, 5).map((e) => (
                      <div key={e.id} className="flex justify-between gap-3 text-ink-300">
                        <span className="min-w-0 truncate">
                          {formatDateTime(e.at)} • {DEPOSIT_METHOD_LABELS[e.method] ?? e.method} • {e.userName}
                          {e.note ? ` • ${e.note}` : ''}
                        </span>
                        <span className={`flex-none font-semibold tabular-nums ${e.amount > 0 ? 'text-success-400' : 'text-red-400'}`}>
                          {e.amount > 0 ? '+' : '−'}
                          {formatRupiah(Math.abs(e.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <h3 className="mb-2 font-semibold text-ink-100">Riwayat Pembelian</h3>
            <div className="space-y-2">
              {history.map((order) => (
                <div key={order.id} className="card flex justify-between p-3">
                  <div>
                    <p className="font-medium text-ink-50">{order.orderNumber}</p>
                    <p className="text-xs text-ink-400">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-brand-400">{formatRupiah(order.grandTotal)}</p>
                    {(order.pointsEarned || order.pointsRedeemed) ? (
                      <p className="text-xs text-ink-300">
                        {order.pointsEarned ? `+${formatNumber(order.pointsEarned)} poin` : ''}
                        {order.pointsEarned && order.pointsRedeemed ? ' • ' : ''}
                        {order.pointsRedeemed ? `−${formatNumber(order.pointsRedeemed)} poin` : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-ink-500">Belum ada transaksi</p>}
            </div>
          </div>
        )}
      </div>

      {showAdjust && selected && (
        <AdjustPointsModal
          customer={selected}
          onClose={() => setShowAdjust(false)}
          onSubmit={async (delta, reason) => {
            await adjustCustomerPoints(selected.id, delta, reason, { userId: currentUser.id, userName: currentUser.name })
            toast.success('Poin dikoreksi.')
            setShowAdjust(false)
          }}
        />
      )}
      {showDeposit && selected && deposit && (
        <DepositModal
          customer={selected}
          balance={deposit.balance}
          canWithdraw={canManage}
          onClose={() => setShowDeposit(false)}
          onSubmit={async (amount, method, note) => {
            await recordCustomerDeposit({ customerId: selected.id, amount, method, note, actor: { userId: currentUser.id, userName: currentUser.name } })
            toast.success(amount > 0 ? 'Saldo diisi.' : 'Saldo ditarik.')
            setShowDeposit(false)
          }}
        />
      )}
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
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '')

  async function handleSave() {
    if (!name.trim()) return
    if (initial) {
      await updateCustomer(initial.id, { name, phone, note, birthDate: birthDate || null })
      onSaved({ ...initial, name, phone, note, birthDate: birthDate || null })
    } else {
      const created = await createCustomer({ name, phone, note, birthDate: birthDate || null })
      onSaved(created)
    }
  }

  return (
    <Modal onClose={onClose}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Pelanggan' : 'Pelanggan Baru'}</h2>
        <input className="input-field mb-3" placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input-field mb-3" placeholder="Telepon" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Tanggal lahir (opsional, untuk promo ulang tahun)</span>
          <input type="date" className="input-field" aria-label="Tanggal lahir" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </label>
        <textarea className="input-field mb-4" placeholder="Catatan" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void handleSave()}>
            Simpan
          </button>
        </div>
    </Modal>
  )
}

function AdjustPointsModal({ customer, onClose, onSubmit }: { customer: Customer; onClose: () => void; onSubmit: (delta: number, reason: string) => Promise<void> }) {
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Koreksi Poin • {customer.name}</h2>
      <p className="mb-3 text-sm text-ink-400">Angka positif menambah poin, negatif mengurangi. Tercatat di Log Aktivitas.</p>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Jumlah poin (+/−)</span>
        <input type="number" className="input-field" autoFocus value={delta} onChange={(e) => setDelta(Math.trunc(Number(e.target.value) || 0))} />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Alasan</span>
        <input className="input-field" placeholder='mis. "bonus ulang tahun"' value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button
          className="btn-primary flex-[2]"
          disabled={!delta || !reason.trim()}
          onClick={() => void onSubmit(delta, reason).catch((e) => setError(e instanceof Error ? e.message : 'Gagal mengoreksi poin'))}
        >
          Simpan Koreksi
        </button>
      </div>
    </Modal>
  )
}

const DEPOSIT_METHOD_LABELS: Partial<Record<PaymentMethod, string>> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' }

function DepositModal({
  customer,
  balance,
  canWithdraw,
  onClose,
  onSubmit,
}: {
  customer: Customer
  balance: number
  canWithdraw: boolean
  onClose: () => void
  onSubmit: (amount: number, method: PaymentMethod, note: string) => Promise<void>
}) {
  const [mode, setMode] = useState<'topup' | 'withdraw'>('topup')
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const withdraw = mode === 'withdraw'

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(withdraw ? -amount : amount, method, note)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Saldo Member • {customer.name}</h2>
      <p className="mb-3 text-sm text-ink-400">Saldo saat ini {formatRupiah(balance)}</p>
      {canWithdraw && (
        <div className="mb-3 flex gap-2">
          {(['topup', 'withdraw'] as const).map((m) => (
            <button key={m} className={`btn btn-compact flex-1 text-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode(m)}>
              {m === 'topup' ? 'Isi Saldo' : 'Tarik / Koreksi'}
            </button>
          ))}
        </div>
      )}
      <label className="mb-2 block">
        <span className="mb-1 block text-sm text-ink-300">Nominal</span>
        <input className="input-field" inputMode="numeric" autoFocus aria-label="Nominal saldo" value={amount ? formatRupiah(amount) : ''} placeholder="Rp0" onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
      </label>
      {!withdraw && (
        <div className="mb-3 flex gap-2">
          {[50_000, 100_000, 200_000, 500_000].map((v) => (
            <button key={v} className="btn-secondary btn-compact flex-1 !px-1 text-sm" onClick={() => setAmount(v)}>
              {formatNumber(v / 1000)}rb
            </button>
          ))}
        </div>
      )}
      <span className="mb-1 block text-sm text-ink-300">{withdraw ? 'Dikembalikan lewat' : 'Dibayar dengan'}</span>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {DEPOSIT_TOPUP_METHODS.map((m) => (
          <button key={m} className={`btn btn-compact !px-1 text-sm ${method === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod(m)}>
            {DEPOSIT_METHOD_LABELS[m]}
          </button>
        ))}
      </div>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">{withdraw ? 'Alasan (wajib)' : 'Catatan (opsional)'}</span>
        <input className="input-field" aria-label="Catatan saldo" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="mb-3 text-xs text-ink-400">Tunai tercatat otomatis sebagai Kas {withdraw ? 'Keluar' : 'Masuk'} di shift yang sedang buka.</p>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !(amount > 0) || (withdraw && !note.trim())} onClick={() => void submit()}>
          {withdraw ? 'Tarik Saldo' : 'Isi Saldo'}
        </button>
      </div>
    </Modal>
  )
}
