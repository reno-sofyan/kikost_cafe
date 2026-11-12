import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listMarketingSales, searchCustomers } from '@/db/repositories/customers'
import { listKols } from '@/db/repositories/promos'
import { listTables, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { listWaiterCandidates } from '@/db/repositories/users'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { SalesAvatar } from '@/features/customers/SalesAvatar'
import { ONLINE_PLATFORMS, ONLINE_PLATFORM_LABELS } from '@/lib/onlineOrders'
import type { Customer, HppPricingKind, OnlinePlatform, OrderType } from '@/types/domain'

/** Jenis tagihan pesanan selain pesanan biasa (kafe): harga HPP, atau Tagihan Marketing. */
export type NewOrderBilling =
  | { kind: HppPricingKind; kolId: string | null; name: string; reason: string }
  | { kind: 'marketing'; salesId: string; clientName: string; purpose: string }

type BillingChoice = 'normal' | HppPricingKind | 'marketing'

const BILLING_OPTIONS: { value: BillingChoice; label: string; icon: IconName; hint: string }[] = [
  { value: 'normal', label: 'Biasa', icon: 'receipt', hint: '' },
  { value: 'kol', label: 'KOL', icon: 'megaphone', hint: 'Semua item dihargai HPP. Pajak, service, diskon & promo dinolkan.' },
  { value: 'compliment', label: 'Compliment', icon: 'star', hint: 'Semua item dihargai HPP. Penerima diambil dari Catatan / Nama Pelanggan.' },
  { value: 'calibration', label: 'Kalibrasi', icon: 'coffee', hint: 'Uji rasa / kalibrasi resep. Semua item dihargai HPP dan tetap dibayar.' },
  { value: 'marketing', label: 'Marketing', icon: 'user', hint: 'Jamuan klien oleh sales — harga jual normal (diskon boleh), ditagihkan ke kantor.' },
]

interface Props {
  /** Jenis pesanan yang relevan untuk jenis usaha; elemen pertama = default. */
  orderTypes: OrderType[]
  /** Tampilkan jumlah tamu & pilihan meja untuk dine-in (hanya usaha dengan meja). */
  showTables: boolean
  /** Kantin: "Nama Pembeli" wajib diisi & tampil paling atas (dipakai memanggil antrean). */
  requireBuyerName?: boolean
  /** Kafe & restoran: tampilkan pilihan pelayan untuk pesanan dine-in. */
  showWaiter?: boolean
  defaultWaiterId?: string | null
  /** Kafe: pilihan KOL / Compliment / Kalibrasi (harga HPP). */
  showHppBilling?: boolean
  /** Kafe: pilihan Tagihan Marketing (sales dari Pelanggan → Tim Marketing). */
  showMarketingBilling?: boolean
  onCancel: () => void
  onConfirm: (params: {
    type: OrderType
    customerId?: string
    guestCount?: number
    notes?: string
    tableId?: string
    waiter?: { id: string; name: string } | null
    onlinePlatform?: OnlinePlatform
    onlineOrderRef?: string
    billing?: NewOrderBilling
  }) => void
}

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Online',
}

export function NewOrderModal({
  orderTypes,
  showTables,
  requireBuyerName = false,
  showWaiter = false,
  defaultWaiterId = null,
  showHppBilling = false,
  showMarketingBilling = false,
  onCancel,
  onConfirm,
}: Props) {
  const [type, setType] = useState<OrderType>(orderTypes[0] ?? 'dine_in')
  const [guestCount, setGuestCount] = useState(1)
  const [notes, setNotes] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [tableId, setTableId] = useState<string | null>(null)
  const [waiterId, setWaiterId] = useState<string | null>(defaultWaiterId)
  const [platform, setPlatform] = useState<OnlinePlatform>('gofood')
  const [onlineRef, setOnlineRef] = useState('')
  const isOnline = type === 'delivery'
  const [billing, setBilling] = useState<BillingChoice>('normal')
  const [kolId, setKolId] = useState<string | null>(null)
  const [kolOther, setKolOther] = useState('')
  const [calibrationNote, setCalibrationNote] = useState('')
  const [salesId, setSalesId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [purpose, setPurpose] = useState('')
  const billingOptions = BILLING_OPTIONS.filter(
    (o) => o.value === 'normal' || (o.value === 'marketing' ? showMarketingBilling : showHppBilling),
  )
  const showBilling = !isOnline && billingOptions.length > 1
  const activeBilling: BillingChoice = showBilling ? billing : 'normal'
  const kols = (useLiveQuery(() => (showHppBilling ? listKols() : []), [showHppBilling]) ?? []).filter((k) => k.active)
  const salesList = useLiveQuery(() => (showMarketingBilling ? listMarketingSales(true) : []), [showMarketingBilling]) ?? []
  const waiters = useLiveQuery(() => (showWaiter ? listWaiterCandidates() : []), [showWaiter]) ?? []

  const customerResults = useLiveQuery(() => searchCustomers(customerQuery), [customerQuery]) ?? []
  const tables = useLiveQuery(() => listTables(), []) ?? []
  const selectableTables = tables.filter((t) => t.status === 'available' || t.id === tableId)

  const billingReady =
    activeBilling === 'kol' ? !!kolId || kolOther.trim().length > 0 : activeBilling === 'marketing' ? !!salesId : true
  const canConfirm = (!requireBuyerName || notes.trim().length > 0) && billingReady

  function billingParams(): NewOrderBilling | undefined {
    if (activeBilling === 'normal') return undefined
    if (activeBilling === 'marketing') return { kind: 'marketing', salesId: salesId!, clientName, purpose }
    if (activeBilling === 'kol') return { kind: 'kol', kolId, name: kolId ? '' : kolOther, reason: '' }
    return { kind: activeBilling, kolId: null, name: '', reason: activeBilling === 'calibration' ? calibrationNote : '' }
  }

  function handleConfirm() {
    if (!canConfirm) return
    onConfirm({
      billing: billingParams(),
      type,
      customerId: activeBilling === 'marketing' ? undefined : customer?.id,
      guestCount: showTables && type === 'dine_in' ? guestCount : undefined,
      notes: notes.trim() || undefined,
      tableId: showTables && type === 'dine_in' && tableId ? tableId : undefined,
      waiter: (() => {
        const w = showWaiter && !isOnline ? waiters.find((u) => u.id === waiterId) : undefined
        return w ? { id: w.id, name: w.name } : null
      })(),
      onlinePlatform: isOnline ? platform : undefined,
      onlineOrderRef: isOnline ? onlineRef.trim() || undefined : undefined,
    })
  }

  return (
    <Modal onClose={onCancel} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-900 p-6">
        <h2 className="mb-4 text-lg font-bold text-ink-50">Pesanan Baru</h2>

        {requireBuyerName && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">Nama Pembeli</h3>
            <input
              className="input-field"
              placeholder='mis. "Budi"'
              value={notes}
              maxLength={60}
              autoFocus
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm()
              }}
            />
            <p className="mt-1 text-xs text-ink-500">Tampil di antrean, layar dapur & struk untuk memanggil pembeli.</p>
          </div>
        )}

        {orderTypes.length > 1 && (
          <div className={`mb-4 grid gap-2 ${orderTypes.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {orderTypes.map((value) => (
              <button
                key={value}
                onClick={() => setType(value)}
                className={`btn ${type === value ? 'btn-primary' : 'btn-secondary'}`}
              >
                {ORDER_TYPE_LABELS[value]}
              </button>
            ))}
          </div>
        )}

        {isOnline && (
          <div className="mb-4 rounded-xl border border-ink-700 p-3">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">Platform</h3>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {ONLINE_PLATFORMS.map((p) => (
                <button key={p} onClick={() => setPlatform(p)} className={`btn btn-compact text-sm ${platform === p ? 'btn-primary' : 'btn-secondary'}`}>
                  {ONLINE_PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">No. Pesanan di Aplikasi (opsional)</span>
              <input
                className="input-field"
                placeholder='mis. "F-123456" atau 4 digit terakhir'
                maxLength={40}
                value={onlineRef}
                onChange={(e) => setOnlineRef(e.target.value)}
              />
            </label>
            <p className="mt-2 text-xs text-ink-500">
              Memakai Harga Online tiap produk (bila diisi). Tanpa pajak, service charge, & pembulatan — total mengikuti aplikasi.
            </p>
          </div>
        )}

        {showTables && type === 'dine_in' && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-sm text-ink-300">Jumlah Tamu</span>
              <button className="btn-secondary btn-compact !px-3" onClick={() => setGuestCount((g) => Math.max(1, g - 1))}>
                −
              </button>
              <span className="w-6 text-center font-bold">{guestCount}</span>
              <button className="btn-secondary btn-compact !px-3" onClick={() => setGuestCount((g) => g + 1)}>
                +
              </button>
            </div>

            {tables.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-300">Meja (opsional)</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={`btn btn-compact !px-3 text-sm ${tableId === null ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setTableId(null)}
                  >
                    Tanpa meja
                  </button>
                  {selectableTables.map((t) => (
                    <button
                      key={t.id}
                      className={`btn btn-compact !px-3 text-sm ${tableId === t.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTableId(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {selectableTables.length === 0 && (
                  <p className="mt-1 text-xs text-ink-500">Semua meja sedang terisi — pesanan dibuat tanpa meja.</p>
                )}
                {tableId && tables.find((t) => t.id === tableId)?.status !== 'available' && (
                  <p className="mt-1 text-xs text-yellow-400">
                    Meja ini berstatus {TABLE_STATUS_LABELS[tables.find((t) => t.id === tableId)!.status].toLowerCase()}.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {showWaiter && !isOnline && waiters.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">Pelayan (opsional)</h3>
            <div className="flex flex-wrap gap-2">
              <button
                className={`btn btn-compact !px-3 text-sm ${waiterId === null ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setWaiterId(null)}
              >
                Tidak dicatat
              </button>
              {waiters.map((u) => (
                <button
                  key={u.id}
                  className={`btn btn-compact !px-3 text-sm ${waiterId === u.id ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setWaiterId(u.id)}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {showBilling && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">Jenis Tagihan</h3>
            <div className="grid grid-cols-5 gap-1.5">
              {billingOptions.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setBilling(o.value)}
                  className={`btn btn-compact flex-col !gap-1 !px-1 !py-2 text-xs ${activeBilling === o.value ? 'btn-primary' : 'btn-secondary'}`}
                >
                  <Icon name={o.icon} size={16} />
                  {o.label}
                </button>
              ))}
            </div>
            {activeBilling !== 'normal' && <p className="mt-1.5 text-xs text-ink-400">{BILLING_OPTIONS.find((o) => o.value === activeBilling)?.hint}</p>}

            {activeBilling === 'kol' && (
              <div className="mt-2 rounded-xl border border-ink-700 p-3">
                <div className="flex flex-wrap gap-2">
                  {kols.map((k) => (
                    <button
                      key={k.id}
                      className={`btn btn-compact !px-3 text-sm ${kolId === k.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => {
                        setKolId(k.id)
                        setKolOther('')
                      }}
                    >
                      {k.name}
                    </button>
                  ))}
                  {kols.length === 0 && <p className="text-xs text-ink-400">Belum ada KOL terdaftar di menu KOL.</p>}
                </div>
                <input
                  className="input-field mt-2"
                  maxLength={60}
                  placeholder="KOL lain (belum terdaftar)"
                  aria-label="Nama KOL lain"
                  value={kolOther}
                  onChange={(e) => {
                    setKolOther(e.target.value)
                    if (e.target.value) setKolId(null)
                  }}
                />
              </div>
            )}

            {activeBilling === 'calibration' && (
              <input
                className="input-field mt-2"
                maxLength={80}
                placeholder='Keterangan (opsional), mis. "kalibrasi espresso pagi"'
                aria-label="Keterangan kalibrasi"
                value={calibrationNote}
                onChange={(e) => setCalibrationNote(e.target.value)}
              />
            )}

            {activeBilling === 'marketing' && (
              <div className="mt-2 rounded-xl border border-ink-700 p-3">
                <span className="mb-2 block text-sm text-ink-300">
                  Sales <span className="text-red-400">*</span>
                </span>
                {salesList.length === 0 ? (
                  <p className="text-xs text-ink-400">Belum ada sales. Daftarkan dulu di Pelanggan → Tim Marketing.</p>
                ) : (
                  <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto">
                    {salesList.map((sales) => (
                      <button
                        key={sales.id}
                        aria-pressed={salesId === sales.id}
                        onClick={() => setSalesId(sales.id)}
                        className={`flex items-center gap-2.5 rounded-xl border p-2 text-left ${
                          salesId === sales.id ? 'border-brand-600 bg-brand-600/15' : 'border-ink-700 bg-ink-900 hover:bg-ink-800'
                        }`}
                      >
                        <SalesAvatar name={sales.name} photo={sales.marketingSales?.photoDataUrl ?? null} size={40} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink-50">{sales.name}</span>
                          {sales.marketingSales?.division && <span className="block truncate text-xs text-ink-400">{sales.marketingSales.division}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="input-field mt-3"
                  maxLength={80}
                  placeholder="Nama klien / perusahaan (opsional)"
                  aria-label="Nama klien"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
                <input
                  className="input-field mt-2"
                  maxLength={120}
                  placeholder='Keperluan (opsional), mis. "meeting proyek X"'
                  aria-label="Keperluan"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {!requireBuyerName && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">{isOnline ? 'Nama Pelanggan / Driver (opsional)' : 'Catatan / Nama Pelanggan (opsional)'}</h3>
            <input
              className="input-field"
              placeholder='mis. "Budi" atau "cewe jaket merah"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-500">Muncul di layar dapur & struk untuk memudahkan panggil pesanan.</p>
          </div>
        )}

        {activeBilling !== 'marketing' && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-300">Pelanggan Terdaftar (opsional)</h3>
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
        )}

        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={handleConfirm} disabled={!canConfirm}>
            Mulai Pesanan
          </button>
        </div>
    </Modal>
  )
}
