import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listMarketingSales, searchCustomers } from '@/db/repositories/customers'
import { depositEnabledFor, listCustomerDeposits } from '@/db/repositories/deposits'
import { getSettings } from '@/db/repositories/settings'
import { formatRupiah } from '@/lib/currency'
import { listKols } from '@/db/repositories/promos'
import { listTables, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { listWaiterCandidates } from '@/db/repositories/users'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
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

export interface NewOrderModalProps {
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
}: NewOrderModalProps) {
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
  // Klien Tagihan Marketing bisa dipilih dari pelanggan terdaftar → saldo membernya bisa dipakai melunasi.
  const clientResults = useLiveQuery(() => (activeBilling === 'marketing' && clientName.trim() ? searchCustomers(clientName) : []), [activeBilling, clientName]) ?? []
  const deposits = useLiveQuery(async () => (depositEnabledFor(await getSettings()) ? listCustomerDeposits() : new Map()), [])
  // Klien terdaftar hanya bila namanya masih sama dengan pelanggan yang dipilih dari daftar.
  const clientCustomer = customer && customer.name === clientName ? customer : null
  const saldoOf = (c: Customer) => {
    const balance = deposits?.get(c.id)?.balance ?? 0
    return balance > 0 ? ` • saldo ${formatRupiah(balance)}` : ''
  }
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
      customerId: activeBilling === 'marketing' ? clientCustomer?.id : customer?.id,
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

  /** Alasan tombol utama nonaktif — tampil di samping tombol. */
  const blockReason = requireBuyerName && !notes.trim()
    ? 'Isi nama pembeli'
    : activeBilling === 'kol' && !billingReady
      ? 'Pilih KOL atau tulis namanya'
      : activeBilling === 'marketing' && !billingReady
        ? 'Pilih sales'
        : null
  const activeHint = BILLING_OPTIONS.find((o) => o.value === activeBilling)?.hint ?? ''
  /** Usaha dengan banyak pilihan (kafe/resto): bingkai tinggi tetap — tak melompat saat tipe berganti. */
  const roomy = showTables || showWaiter || billingOptions.length > 1
  const showGuests = showTables && type === 'dine_in'

  return (
    <Modal
      onClose={onCancel}
      motion="pop"
      className={`flex max-h-[calc(100dvh-2rem)] w-[min(62rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-ink-900 ${roomy ? 'md:h-[min(31.5rem,calc(100dvh-2rem))]' : 'md:w-[min(44rem,calc(100vw-2rem))]'}`}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          handleConfirm()
        }}
      >
        <header className="flex flex-none items-center gap-3 border-b border-ink-700 px-6 py-3.5">
          <h2 className="text-lg font-bold text-ink-50">Pesanan Baru</h2>
          <span className="ml-auto hidden items-center gap-3 text-xs text-ink-300 md:flex" aria-hidden="true">
            <span>
              <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-sans text-[0.7rem] font-semibold text-ink-200">Enter</kbd> mulai
            </span>
            <span>
              <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-sans text-[0.7rem] font-semibold text-ink-200">Esc</kbd> batal
            </span>
          </span>
        </header>

        <div className="grid min-h-0 flex-1 gap-y-3 overflow-y-auto px-6 py-4 md:grid-cols-2 md:divide-x md:divide-ink-700 md:overflow-hidden">
          {/* ---- Kolom kiri: tipe, tamu, meja/platform, pelayan ---- */}
          <div className="flex min-h-0 flex-col gap-3 md:pr-6">
            {(orderTypes.length > 1 || showTables) && (
              <div className="flex flex-none items-end gap-3">
                {orderTypes.length > 1 && (
                  <div className="min-w-0 flex-1">
                    <FieldLabel>Tipe pesanan</FieldLabel>
                    <div role="group" aria-label="Tipe pesanan" className="flex gap-1 rounded-xl bg-ink-800 p-1">
                      {orderTypes.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={type === value}
                          onClick={() => setType(value)}
                          className={`kione-chip flex-1 ${type === value ? 'kione-chip--on' : 'kione-chip--flat'}`}
                        >
                          {ORDER_TYPE_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {showTables && (
                  // Ruang dicadangkan (invisible, bukan dihapus) supaya baris tak bergeser saat bukan dine-in.
                  <div className={`flex-none ${showGuests ? '' : 'invisible'}`} aria-hidden={!showGuests}>
                    <FieldLabel>Tamu</FieldLabel>
                    <div className="flex items-center gap-1 rounded-xl bg-ink-800 p-1">
                      <button type="button" className="kione-chip kione-chip--flat !px-3" aria-label="Kurangi tamu" tabIndex={showGuests ? 0 : -1} onClick={() => setGuestCount((g) => Math.max(1, g - 1))}>
                        <Icon name="minus" size={16} />
                      </button>
                      <span className="w-8 text-center text-base font-bold tabular-nums text-ink-50" aria-live="polite">
                        {guestCount}
                      </span>
                      <button type="button" className="kione-chip kione-chip--flat !px-3" aria-label="Tambah tamu" tabIndex={showGuests ? 0 : -1} onClick={() => setGuestCount((g) => g + 1)}>
                        <Icon name="plus" size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isOnline && (
              <div className="flex-none space-y-3">
                <div>
                  <FieldLabel>Platform</FieldLabel>
                  <div role="group" aria-label="Platform" className="grid grid-cols-2 gap-2">
                    {ONLINE_PLATFORMS.map((pl) => (
                      <button key={pl} type="button" aria-pressed={platform === pl} onClick={() => setPlatform(pl)} className={`kione-chip ${platform === pl ? 'kione-chip--on' : ''}`}>
                        {ONLINE_PLATFORM_LABELS[pl]}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <FieldLabel>No. pesanan di aplikasi</FieldLabel>
                  <input className="input-field" placeholder='mis. "F-123456"' maxLength={40} value={onlineRef} onChange={(e) => setOnlineRef(e.target.value)} />
                </label>
                <p className="text-xs text-ink-300">Harga online, tanpa pajak/service/pembulatan — total mengikuti aplikasi.</p>
              </div>
            )}

            {showGuests && tables.length > 0 && (
              <div className="flex min-h-0 flex-col">
                <FieldLabel>Meja</FieldLabel>
                <div role="group" aria-label="Meja" className="flex min-h-0 flex-wrap content-start gap-2 overflow-y-auto pb-1">
                  <button type="button" aria-pressed={tableId === null} onClick={() => setTableId(null)} className={`kione-chip ${tableId === null ? 'kione-chip--on' : ''}`}>
                    Tanpa meja
                  </button>
                  {selectableTables.map((t) => (
                    <button key={t.id} type="button" aria-pressed={tableId === t.id} title={t.name} onClick={() => setTableId(t.id)} className={`kione-chip max-w-[12rem] ${tableId === t.id ? 'kione-chip--on' : ''}`}>
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
                {selectableTables.length === 0 && <p className="mt-1 text-xs text-ink-300">Semua meja terisi — pesanan dibuat tanpa meja.</p>}
                {tableId && tables.find((t) => t.id === tableId)?.status !== 'available' && (
                  <p className="mt-1 text-xs text-accent-700">Meja ini berstatus {TABLE_STATUS_LABELS[tables.find((t) => t.id === tableId)!.status].toLowerCase()}.</p>
                )}
              </div>
            )}

            {showWaiter && !isOnline && waiters.length > 0 && (
              <div className="flex-none">
                <FieldLabel>Pelayan</FieldLabel>
                <div role="group" aria-label="Pelayan" className="flex max-h-[6.5rem] flex-wrap gap-2 overflow-y-auto">
                  <button type="button" aria-pressed={waiterId === null} onClick={() => setWaiterId(null)} className={`kione-chip ${waiterId === null ? 'kione-chip--on' : ''}`}>
                    Tidak dicatat
                  </button>
                  {waiters.map((u) => (
                    <button key={u.id} type="button" aria-pressed={waiterId === u.id} onClick={() => setWaiterId(u.id)} className={`kione-chip ${waiterId === u.id ? 'kione-chip--on' : ''}`}>
                      {u.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ---- Kolom kanan: nama pembeli, jenis tagihan, catatan, pelanggan ---- */}
          <div className="flex min-h-0 flex-col gap-3 md:pl-6">
            {requireBuyerName && (
              <label className="block flex-none">
                <FieldLabel required>Nama pembeli</FieldLabel>
                <input className="input-field" placeholder='mis. "Budi"' value={notes} maxLength={60} autoFocus onChange={(e) => setNotes(e.target.value)} />
              </label>
            )}

            {showBilling && (
              <div className="flex min-h-0 flex-col">
                <FieldLabel>Jenis tagihan</FieldLabel>
                <div role="group" aria-label="Jenis tagihan" className="grid flex-none gap-1 rounded-xl bg-ink-800 p-1" style={{ gridTemplateColumns: `repeat(${billingOptions.length}, minmax(0, 1fr))` }}>
                  {billingOptions.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={activeBilling === o.value}
                      title={o.hint || undefined}
                      onClick={() => setBilling(o.value)}
                      className={`kione-chip flex-col !gap-0.5 !px-1 text-xs ${activeBilling === o.value ? 'kione-chip--on' : 'kione-chip--flat'}`}
                    >
                      <Icon name={o.icon} size={16} />
                      <span className="max-w-full truncate">{o.label}</span>
                    </button>
                  ))}
                </div>
                {/* Penjelas satu baris, hanya untuk pilihan yang aktif (ruangnya selalu dicadangkan). */}
                <p className="mt-1 h-4 flex-none truncate text-xs text-ink-300" title={activeHint}>
                  {activeHint}
                </p>

                {activeBilling === 'kol' && (
                  <div className="mt-2 flex min-h-0 flex-col gap-2 overflow-y-auto">
                    {kols.length > 0 && (
                      <div role="group" aria-label="KOL" className="flex flex-wrap gap-2">
                        {kols.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            aria-pressed={kolId === k.id}
                            onClick={() => {
                              setKolId(k.id)
                              setKolOther('')
                            }}
                            className={`kione-chip ${kolId === k.id ? 'kione-chip--on' : ''}`}
                          >
                            {k.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      className="input-field"
                      maxLength={60}
                      placeholder={kols.length ? 'KOL lain (belum terdaftar)' : 'Nama KOL (belum ada di menu KOL)'}
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
                    placeholder='Keterangan, mis. "kalibrasi espresso pagi"'
                    aria-label="Keterangan kalibrasi"
                    value={calibrationNote}
                    onChange={(e) => setCalibrationNote(e.target.value)}
                  />
                )}

                {activeBilling === 'marketing' && (
                  <div className="mt-2 flex min-h-0 flex-col gap-2">
                    {salesList.length === 0 ? (
                      <p className="text-xs text-ink-300">Belum ada sales. Daftarkan di Pelanggan → Tim Marketing.</p>
                    ) : (
                      <div role="group" aria-label="Sales" className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto">
                        {salesList.map((sales) => (
                          <button
                            key={sales.id}
                            type="button"
                            aria-pressed={salesId === sales.id}
                            onClick={() => setSalesId(sales.id)}
                            className={`flex min-h-[3rem] items-center gap-2 rounded-xl border p-1.5 text-left ${
                              salesId === sales.id ? 'border-brand-600 bg-brand-600/15' : 'border-ink-600 bg-ink-900 hover:bg-ink-800'
                            }`}
                          >
                            <SalesAvatar name={sales.name} photo={sales.marketingSales?.photoDataUrl ?? null} size={32} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-ink-50">{sales.name}</span>
                              {sales.marketingSales?.division && <span className="block truncate text-xs text-ink-300">{sales.marketingSales.division}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid flex-none grid-cols-2 items-start gap-2">
                      <div className="relative min-w-0">
                        <input
                          className="input-field"
                          maxLength={80}
                          placeholder="Klien / pelanggan terdaftar"
                          aria-label="Nama klien"
                          autoComplete="off"
                          value={clientName}
                          onChange={(e) => {
                            setCustomer(null)
                            setClientName(e.target.value)
                          }}
                        />
                        {clientCustomer && (
                          <p className="mt-1 truncate text-xs font-semibold text-brand-400">Terdaftar{saldoOf(clientCustomer)}</p>
                        )}
                        {!clientCustomer && clientResults.length > 0 && (
                          <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-48 overflow-y-auto rounded-xl border border-ink-600 bg-ink-900 shadow-pop">
                            {clientResults.map((c: Customer) => (
                              <button
                                key={c.id}
                                type="button"
                                className="block w-full px-3 py-2.5 text-left text-sm text-ink-100 hover:bg-ink-800"
                                onClick={() => {
                                  setCustomer(c)
                                  setClientName(c.name)
                                }}
                              >
                                {c.name} {c.phone && `• ${c.phone}`}
                                {saldoOf(c)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input className="input-field" maxLength={120} placeholder="Keperluan" aria-label="Keperluan" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={`grid flex-none gap-3 ${!requireBuyerName && activeBilling !== 'marketing' ? 'grid-cols-2' : ''}`}>
            {!requireBuyerName && (
              <label className="block min-w-0">
                <FieldLabel>{isOnline ? 'Nama pelanggan / driver' : 'Catatan / nama pelanggan'}</FieldLabel>
                <input
                  className="input-field"
                  placeholder={activeBilling === 'compliment' ? 'Nama penerima' : 'Nama / ciri pelanggan'}
                  title="Tampil di layar dapur & struk untuk memanggil pesanan"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            )}

            {activeBilling !== 'marketing' && (
              <div className="relative min-w-0">
                <FieldLabel>Pelanggan terdaftar</FieldLabel>
                <input
                  className="input-field"
                  placeholder="Nama / telepon member"
                  aria-label="Cari pelanggan terdaftar"
                  autoComplete="off"
                  value={customer ? customer.name : customerQuery}
                  onChange={(e) => {
                    setCustomer(null)
                    setCustomerQuery(e.target.value)
                  }}
                />
                {/* Hasil di atas konten (bukan mendorong isi modal). */}
                {customerQuery && !customer && customerResults.length > 0 && (
                  <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-48 overflow-y-auto rounded-xl border border-ink-600 bg-ink-900 shadow-pop">
                    {customerResults.map((c: Customer) => (
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full px-3 py-2.5 text-left text-sm text-ink-100 hover:bg-ink-800"
                        onClick={() => {
                          setCustomer(c)
                          setCustomerQuery('')
                        }}
                      >
                        {c.name} {c.phone && `• ${c.phone}`}
                        {saldoOf(c)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* ---- Footer tetap: selalu terlihat tanpa scroll ---- */}
        <div className="flex flex-none items-center justify-end gap-3 border-t border-ink-700 bg-ink-800/60 px-6 py-3">
          {blockReason && (
            <p className="mr-auto flex items-center gap-1.5 text-sm text-ink-200" role="status">
              <Icon name="alertTriangle" size={15} className="text-accent-500" />
              {blockReason}
            </p>
          )}
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Batal
          </Button>
          <Button type="submit" size="lg" className="kbtn--readable min-w-[13rem]" disabled={!canConfirm}>
            Mulai Pesanan
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Label kecil di atas grup pilihan; `required` = bintang merah. */
function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-wider text-ink-300">
      {children}
      {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
    </span>
  )
}
