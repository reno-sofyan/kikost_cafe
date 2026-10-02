import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { randomUUID } from '@/lib/id'

/**
 * Halaman pesan-mandiri pelanggan (publik, tanpa login, tanpa Dexie).
 * Disajikan same-origin dengan backend: fetch relatif ke `/api/t/:token`.
 * Semua harga & total dihitung server — halaman ini hanya menampilkan.
 */

const API = ''

interface MenuOption { id: string; name: string; priceDelta: number }
interface MenuGroup { id: string; name: string; required: boolean; multiSelect: boolean; options: MenuOption[] }
interface MenuItem {
  id: string
  categoryId: string
  name: string
  description: string
  price: number
  photoDataUrl: string | null
  modifierGroups: MenuGroup[]
}
interface Menu {
  business: { name: string; address: string; phone: string; logoDataUrl: string | null }
  table: { id: string; name: string }
  fiscal: { taxPercent: number; serviceChargePercent: number }
  categories: { id: string; name: string }[]
  items: MenuItem[]
}

interface CartLine {
  key: string
  item: MenuItem
  qty: number
  optionIds: string[]
  note: string
}

type OrderType = 'dine_in' | 'takeaway'
type PaymentMethod = 'online' | 'cash'

const rupiah = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

/** Total priceDelta varian terpilih pada satu baris keranjang. */
function lineExtra(l: CartLine): number {
  return l.optionIds.reduce((s, oid) => {
    for (const g of l.item.modifierGroups) for (const o of g.options) if (o.id === oid) return s + o.priceDelta
    return s
  }, 0)
}

function findOption(item: MenuItem, optionId: string): MenuOption | undefined {
  for (const g of item.modifierGroups) for (const o of g.options) if (o.id === optionId) return o
  return undefined
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-[#FBF3E8] text-ink-50">
      <div
        className="mx-auto max-w-md px-4 pt-5"
        style={{ paddingBottom: 'calc(11rem + env(safe-area-inset-bottom))' }}
      >
        {children}
      </div>
    </div>
  )
}

function Center({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <div className="mx-auto mt-24 flex max-w-xs flex-col items-center gap-3 text-center text-ink-200">
        {children}
      </div>
      <KioneFooter />
    </Screen>
  )
}

function KioneFooter() {
  return (
    <p className="mt-8 pb-2 text-center text-[0.7rem] text-ink-400">
      Ditenagai <span className="font-semibold text-ink-300">Kione POS</span>
    </p>
  )
}

export function CustomerApp() {
  return (
    <Routes>
      <Route path="/order/:token" element={<OrderFlow />} />
      <Route path="/order/:token/status/:id" element={<StatusPage />} />
      <Route path="*" element={<Center>Halaman tidak ditemukan.</Center>} />
    </Routes>
  )
}

const ALL_CATEGORY = '__all__'

/**
 * Alur pesan-mandiri pelanggan dalam satu route (`/order/:token`): Menu →
 * Detail Produk → Pembayaran. Ketiganya berbagi state keranjang & data
 * pelanggan di sini (bukan route terpisah) supaya keranjang tak hilang saat
 * bolak-balik "Tambah Menu" — hanya submit akhir yang pindah route (ke halaman
 * status pesanan, yang tetap dipakai apa adanya).
 */
function OrderFlow() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [screen, setScreen] = useState<'menu' | 'product' | 'checkout'>('menu')
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORY)

  const [cart, setCart] = useState<CartLine[]>([])
  const [productTarget, setProductTarget] = useState<MenuItem | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const [orderType, setOrderType] = useState<OrderType>('dine_in')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`${API}/api/t/${encodeURIComponent(token)}`)
      .then(async (r) => {
        let body: unknown
        try {
          body = await r.json()
        } catch {
          // Backend tidak terjangkau/salah alamat biasanya menjawab dengan HTML
          // (mis. halaman aplikasi ini sendiri lewat fallback SPA), bukan JSON —
          // tanpa cek ini, body kosong lolos ke bawah dan meledak sebagai
          // "Cannot read properties of undefined" yang membingungkan pelanggan.
          throw new Error('Server pesanan tidak dapat dihubungi. Coba pindai ulang QR atau hubungi staf.')
        }
        if (!r.ok) throw new Error((body as { error?: string })?.error || 'Menu tidak dapat dimuat.')
        if (!body || typeof body !== 'object' || !Array.isArray((body as Menu).items) || !Array.isArray((body as Menu).categories)) {
          throw new Error('Menu tidak dapat dimuat — data dari server tidak lengkap.')
        }
        return body as Menu
      })
      .then((m) => alive && setMenu(m))
      .catch((e) => alive && setLoadErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token])

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.qty, 0), [cart])
  const subtotal = useMemo(() => cart.reduce((sum, l) => sum + (l.item.price + lineExtra(l)) * l.qty, 0), [cart])

  const saveLine = useCallback((line: CartLine, replaceKey?: string) => {
    setCart((c) => (replaceKey ? c.map((l) => (l.key === replaceKey ? line : l)) : [...c, line]))
  }, [])
  const removeLine = useCallback((key: string) => setCart((c) => c.filter((l) => l.key !== key)), [])

  function changeQty(key: string, delta: number) {
    const line = cart.find((l) => l.key === key)
    if (!line) return
    if (line.qty + delta < 1) {
      setDeletingKey(key)
      return
    }
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)))
  }

  function openForAdd(item: MenuItem) {
    setEditingKey(null)
    setProductTarget(item)
    setScreen('product')
  }
  function quickAdd(item: MenuItem) {
    setCart((c) => [...c, { key: randomUUID(), item, qty: 1, optionIds: [], note: '' }])
  }
  function openForEdit(line: CartLine) {
    setEditingKey(line.key)
    setProductTarget(line.item)
    setScreen('product')
  }

  async function submitOrder() {
    if (cart.length === 0 || submitting) return
    setSubmitting(true)
    setSubmitErr(null)
    const idempotencyKey = `${token}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    try {
      const r = await fetch(`${API}/api/t/${encodeURIComponent(token)}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          customerName,
          customerPhone,
          orderType,
          items: cart.map((l) => ({ productId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note })),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Pesanan gagal dikirim.')
      navigate(`/order/${token}/status/${body.orderId}${paymentMethod === 'online' ? '?autopay=1' : ''}`)
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Pesanan gagal dikirim.')
      setSubmitting(false)
    }
  }

  if (loading) return <Center>Memuat menu…</Center>
  if (loadErr && !menu) return <Center>{loadErr}</Center>
  if (!menu) return <Center>Menu tidak tersedia.</Center>

  return (
    <>
      {screen === 'menu' && (
        <MenuScreen
          menu={menu}
          search={search}
          setSearch={setSearch}
          activeCat={activeCat}
          setActiveCat={setActiveCat}
          cartCount={cartCount}
          subtotal={subtotal}
          onOpenItem={openForAdd}
          onQuickAdd={quickAdd}
          onViewCart={() => setScreen('checkout')}
        />
      )}
      {screen === 'product' && productTarget && (
        <ProductDetailScreen
          item={productTarget}
          initial={editingKey ? (cart.find((l) => l.key === editingKey) ?? null) : null}
          onBack={() => setScreen(editingKey ? 'checkout' : 'menu')}
          onSave={(line, replaceKey) => {
            saveLine(line, replaceKey)
            setScreen(replaceKey ? 'checkout' : 'menu')
          }}
        />
      )}
      {screen === 'checkout' && (
        <CheckoutScreen
          menu={menu}
          cart={cart}
          orderType={orderType}
          setOrderType={setOrderType}
          customerName={customerName}
          setCustomerName={setCustomerName}
          customerPhone={customerPhone}
          setCustomerPhone={setCustomerPhone}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          submitting={submitting}
          submitErr={submitErr}
          onBack={() => setScreen('menu')}
          onEditLine={openForEdit}
          onChangeQty={changeQty}
          onSubmit={() => void submitOrder()}
        />
      )}

      {deletingKey && (
        <Modal onClose={() => setDeletingKey(null)} className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-pop">
          <p className="mb-4 font-medium text-ink-50">Yakin untuk menghapus item?</p>
          <div className="flex gap-2">
            <button
              className="btn-danger flex-1"
              onClick={() => {
                removeLine(deletingKey)
                setDeletingKey(null)
              }}
            >
              Hapus
            </button>
            <button className="btn-secondary flex-1" onClick={() => setDeletingKey(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

function MenuScreen(props: {
  menu: Menu
  search: string
  setSearch: (v: string) => void
  activeCat: string
  setActiveCat: (v: string) => void
  cartCount: number
  subtotal: number
  onOpenItem: (item: MenuItem) => void
  onQuickAdd: (item: MenuItem) => void
  onViewCart: () => void
}) {
  const { menu, search, setSearch, activeCat, setActiveCat, cartCount, subtotal, onOpenItem, onQuickAdd, onViewCart } = props
  const q = search.trim().toLowerCase()
  const items = menu.items.filter(
    (i) => (activeCat === ALL_CATEGORY || i.categoryId === activeCat) && (!q || i.name.toLowerCase().includes(q)),
  )
  const tableBadge = menu.table.name.match(/\d+/)?.[0] ?? menu.table.name

  return (
    <Screen>
      <header className="-mx-4 mb-4 rounded-b-3xl bg-[#CDB69C] px-4 pb-6 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xl font-bold leading-snug text-[#402A1E]">Selamat Datang di {menu.business.name}—</p>
            <p className="mt-1 text-sm text-[#5B4636]">Tempat rehat sejenak dari hari yang panjang.</p>
          </div>
          {menu.business.logoDataUrl ? (
            <img src={menu.business.logoDataUrl} alt={menu.business.name} className="h-12 w-12 flex-none rounded-xl object-cover" />
          ) : (
            <span className="flex-none rounded-full border border-[#402A1E]/40 p-2 text-[#402A1E]">
              <Icon name="coffee" size={20} />
            </span>
          )}
        </div>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#402A1E]/30 bg-white/70 px-3 py-1 text-xs font-semibold text-[#402A1E]">
          <Icon name="table" size={13} />
          {tableBadge}
        </span>
      </header>

      <label className="mb-3 block">
        <span className="relative block">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A7864]" />
          <input
            className="w-full rounded-full border border-[#E7D9C7] bg-white py-3 pl-10 pr-4 text-sm text-ink-50 placeholder:text-[#8A7864] focus:border-[#B99B78] focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari minuman dan makanan..."
          />
        </span>
      </label>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          onClick={() => setActiveCat(ALL_CATEGORY)}
          className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            activeCat === ALL_CATEGORY ? 'bg-[#3E2B21] text-white' : 'bg-[#E7DACA] text-[#5B4636]'
          }`}
        >
          Semua
        </button>
        {menu.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              activeCat === c.id ? 'bg-[#3E2B21] text-white' : 'bg-[#E7DACA] text-[#5B4636]'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onOpenItem(item)}
            className="overflow-hidden rounded-2xl bg-white text-left shadow-card transition-transform active:scale-[0.98]"
          >
            <div className="relative aspect-square w-full bg-[#EFE4D4]">
              {item.photoDataUrl && <img src={item.photoDataUrl} alt="" className="h-full w-full object-cover" />}
              <span
                role="button"
                aria-label={`Tambah ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (item.modifierGroups.length > 0) onOpenItem(item)
                  else onQuickAdd(item)
                }}
                className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#3E2B21] text-white shadow-pop"
              >
                <Icon name="plus" size={16} />
              </span>
            </div>
            <div className="p-2.5">
              <p className="truncate text-sm font-semibold text-ink-50">{item.name}</p>
              <p className="mt-0.5 text-xs font-medium text-[#5B4636]">{rupiah(item.price)}</p>
            </div>
          </button>
        ))}
        {items.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-ink-400">Tidak ada item ditemukan.</p>}
      </div>

      {cartCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-[#E7D9C7] bg-white/95 p-3 shadow-[0_-8px_24px_-12px_rgba(70,40,22,0.25)] backdrop-blur"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <button onClick={onViewCart} className="mx-auto flex w-full max-w-md items-center justify-between rounded-2xl bg-[#3E2B21] px-4 py-3 text-white">
            <span className="flex items-center gap-2 text-left">
              <Icon name="cart" size={18} />
              <span>
                <span className="block text-xs text-white/70">{cartCount} Item di Keranjang</span>
                <span className="block text-sm font-bold">{rupiah(subtotal)}</span>
              </span>
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold">
              Lihat Pesanan
              <Icon name="chevronDown" size={16} className="-rotate-90" />
            </span>
          </button>
        </div>
      )}
    </Screen>
  )
}

function RequirementBadge({ group }: { group: MenuGroup }) {
  const label = !group.required ? 'Opsional' : group.multiSelect ? 'Wajib pilih' : 'Pilih satu'
  return <span className="rounded-full bg-[#EFE4D4] px-2.5 py-1 text-xs font-medium text-[#5B4636]">{label}</span>
}

function OptionRow({ selected, label, priceDelta, onClick }: { selected: boolean; label: string; priceDelta: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left text-sm transition-colors ${
        selected ? 'border-[#3E2B21] bg-[#3E2B21]/5' : 'border-[#E7D9C7] bg-white'
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${selected ? 'border-[#3E2B21]' : 'border-ink-500'}`}>
          {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#3E2B21]" />}
        </span>
        {label}
      </span>
      {priceDelta !== 0 && <span className="text-[#5B4636]">+{rupiah(priceDelta)}</span>}
    </button>
  )
}

/** Halaman penuh (bukan sheet) — tampil saat menambah item baru maupun mengedit baris keranjang. */
function ProductDetailScreen({
  item,
  initial,
  onBack,
  onSave,
}: {
  item: MenuItem
  initial: CartLine | null
  onBack: () => void
  onSave: (line: CartLine, replaceKey?: string) => void
}) {
  const [qty, setQty] = useState(initial?.qty ?? 1)
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {}
    if (!initial) return map
    for (const g of item.modifierGroups) {
      const picked = g.options.filter((o) => initial.optionIds.includes(o.id)).map((o) => o.id)
      if (picked.length) map[g.id] = picked
    }
    return map
  })
  const [note, setNote] = useState(initial?.note ?? '')

  function toggle(group: MenuGroup, optId: string) {
    setSelected((prev) => {
      const cur = prev[group.id] ?? []
      if (group.multiSelect) {
        return { ...prev, [group.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] }
      }
      return { ...prev, [group.id]: [optId] }
    })
  }

  const missingRequired = item.modifierGroups.some((g) => g.required && !(selected[g.id]?.length))
  const optionIds = Object.values(selected).flat()
  const extra = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => optionIds.includes(o.id))
    .reduce((s, o) => s + o.priceDelta, 0)

  return (
    <Screen>
      <div className="-mx-4 mb-3 flex items-center gap-3 px-4 pb-2 pt-1">
        <button onClick={onBack} aria-label="Kembali" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-100 hover:bg-ink-800/10">
          <Icon name="arrowLeft" size={20} />
        </button>
        <h1 className="flex-1 text-center text-base font-bold text-ink-50">Detail Produk</h1>
        <span className="w-9" />
      </div>

      {item.photoDataUrl && <img src={item.photoDataUrl} alt="" className="mb-4 h-48 w-full rounded-2xl object-cover" />}

      <h2 className="text-lg font-bold text-ink-50">{item.name}</h2>
      {item.description && <p className="mt-1.5 text-sm text-ink-300">{item.description}</p>}

      {item.modifierGroups.map((g) => (
        <div key={g.id} className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink-50">
              {g.name}
              {g.required && <span className="text-red-400"> *</span>}
            </p>
            <RequirementBadge group={g} />
          </div>
          <div className="space-y-2">
            {g.options.map((o) => (
              <OptionRow
                key={o.id}
                selected={(selected[g.id] ?? []).includes(o.id)}
                label={o.name}
                priceDelta={o.priceDelta}
                onClick={() => toggle(g, o.id)}
              />
            ))}
          </div>
        </div>
      ))}

      <label className="mb-4 mt-5 block">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-50">Catatan Tambahan</span>
          <span className="rounded-full bg-[#EFE4D4] px-2.5 py-1 text-xs font-medium text-[#5B4636]">Opsional</span>
        </div>
        <textarea
          className="input-field min-h-0 bg-white"
          rows={3}
          maxLength={120}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Contoh : Tidak Pakai Sedotan"
        />
      </label>

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[#E7D9C7] bg-white/95 p-3 shadow-[0_-8px_24px_-12px_rgba(70,40,22,0.25)] backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-md items-center gap-3">
          <button
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-[#E7D9C7] bg-white text-lg text-[#3E2B21]"
            onClick={() => setQty((n) => Math.max(1, n - 1))}
          >
            −
          </button>
          <span className="w-6 flex-none text-center text-base font-bold text-ink-50">{qty}</span>
          <button
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-[#E7D9C7] bg-white text-lg text-[#3E2B21]"
            onClick={() => setQty((n) => Math.min(99, n + 1))}
          >
            +
          </button>
          <button
            className="flex min-h-touch flex-1 items-center justify-center rounded-xl bg-[#3E2B21] px-4 text-sm font-semibold text-white disabled:opacity-40"
            disabled={missingRequired}
            onClick={() => onSave({ key: initial?.key ?? randomUUID(), item, qty, optionIds, note }, initial?.key)}
          >
            {missingRequired
              ? 'Pilih varian wajib dulu'
              : `${initial ? 'Simpan Perubahan' : 'Tambah ke Keranjang'} · ${rupiah((item.price + extra) * qty)}`}
          </button>
        </div>
      </div>
    </Screen>
  )
}

const ORDER_TYPE_TABS: { value: OrderType; label: string; icon: 'table' | 'bag' }[] = [
  { value: 'dine_in', label: 'Makan di Tempat', icon: 'table' },
  { value: 'takeaway', label: 'Bawa Pulang', icon: 'bag' },
]

const PAYMENT_METHOD_TABS: { value: PaymentMethod; label: string; icon: 'barcode' | 'receipt' }[] = [
  { value: 'online', label: 'Pembayaran Online', icon: 'barcode' },
  { value: 'cash', label: 'Pembayaran di Kasir', icon: 'receipt' },
]

function CheckoutScreen(props: {
  menu: Menu
  cart: CartLine[]
  orderType: OrderType
  setOrderType: (v: OrderType) => void
  customerName: string
  setCustomerName: (v: string) => void
  customerPhone: string
  setCustomerPhone: (v: string) => void
  paymentMethod: PaymentMethod
  setPaymentMethod: (v: PaymentMethod) => void
  submitting: boolean
  submitErr: string | null
  onBack: () => void
  onEditLine: (line: CartLine) => void
  onChangeQty: (key: string, delta: number) => void
  onSubmit: () => void
}) {
  const {
    menu, cart, orderType, setOrderType, customerName, setCustomerName, customerPhone, setCustomerPhone,
    paymentMethod, setPaymentMethod, submitting, submitErr, onBack, onEditLine, onChangeQty, onSubmit,
  } = props

  const itemCount = cart.reduce((n, l) => n + l.qty, 0)
  const subtotal = cart.reduce((sum, l) => sum + (l.item.price + lineExtra(l)) * l.qty, 0)
  const serviceCharge = Math.round((subtotal * menu.fiscal.serviceChargePercent) / 100)
  const tax = Math.round(((subtotal + serviceCharge) * menu.fiscal.taxPercent) / 100)
  const total = Math.round((subtotal + serviceCharge + tax) / 100) * 100

  const valid = cart.length > 0 && customerName.trim().length > 0 && customerPhone.trim().length >= 8

  return (
    <Screen>
      <div className="-mx-4 mb-1 flex items-center gap-3 px-4 pb-2 pt-1">
        <button onClick={onBack} aria-label="Kembali" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-100 hover:bg-ink-800/10">
          <Icon name="arrowLeft" size={20} />
        </button>
        <h1 className="flex-1 text-center text-base font-bold text-ink-50">Pembayaran</h1>
        <span className="w-9" />
      </div>
      <p className="mb-4 text-sm text-ink-300">Cek lagi pesananmu sebelum lanjut ke pembayaran.</p>

      <div className="mb-4 flex gap-2">
        {ORDER_TYPE_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setOrderType(t.value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-semibold ${
              orderType === t.value ? 'bg-[#3E2B21] text-white' : 'border border-[#E7D9C7] bg-white text-[#5B4636]'
            }`}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-5 rounded-2xl border border-[#E7D9C7] bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-ink-50">Data Pelanggan</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-ink-300">
            Nama Anda<span className="text-red-500">*</span>
          </span>
          <span className="relative block">
            <Icon name="user" size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A7864]" />
            <input
              className="w-full rounded-xl border border-[#E7D9C7] bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-[#8A7864] focus:border-[#B99B78] focus:outline-none"
              value={customerName}
              maxLength={60}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Masukkan Nama Anda"
            />
          </span>
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-ink-300">
            Nomor Handphone<span className="text-red-500">*</span>
          </span>
          <span className="relative block">
            <Icon name="phone" size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A7864]" />
            <input
              className="w-full rounded-xl border border-[#E7D9C7] bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-[#8A7864] focus:border-[#B99B78] focus:outline-none"
              value={customerPhone}
              maxLength={20}
              type="tel"
              inputMode="tel"
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Masukkan Nomor Handphone"
            />
          </span>
        </label>
        {orderType === 'dine_in' && (
          <label className="block">
            <span className="mb-1 block text-xs text-ink-300">
              Nomor Meja<span className="text-red-500">*</span>
            </span>
            <span className="relative block">
              <Icon name="table" size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A7864]" />
              <input
                className="w-full rounded-xl border border-[#E7D9C7] bg-[#F5EEE3] py-2.5 pl-9 pr-3 text-sm text-ink-300"
                value={menu.table.name}
                disabled
                readOnly
              />
            </span>
          </label>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-50">Pesanan Anda</p>
        <button onClick={onBack} className="flex items-center gap-1 rounded-full bg-[#3E2B21] px-3 py-1.5 text-xs font-semibold text-white">
          <Icon name="plus" size={12} /> Tambah Menu
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-[#E7D9C7] bg-white p-4">
        {cart.map((l, i) => {
          const options = l.optionIds.map((oid) => findOption(l.item, oid)).filter((o): o is MenuOption => !!o)
          return (
            <div key={l.key} className={`py-3 ${i > 0 ? 'border-t border-[#EFE4D4]' : 'pt-0'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-50">{l.item.name}</p>
                <div className="flex flex-none items-center gap-2">
                  <button
                    aria-label="Kurangi"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-[#E7D9C7] text-[#5B4636]"
                    onClick={() => onChangeQty(l.key, -1)}
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-semibold text-ink-50">{l.qty}</span>
                  <button
                    aria-label="Tambah"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-[#E7D9C7] text-[#5B4636]"
                    onClick={() => onChangeQty(l.key, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
              {l.note && <p className="mt-0.5 text-xs text-ink-400">Notes : {l.note}</p>}
              <div className="mt-1 flex items-center justify-between">
                <p className="text-sm text-ink-300">{rupiah((l.item.price + lineExtra(l)) * l.qty)}</p>
                <button className="text-xs font-semibold text-blue-600" onClick={() => onEditLine(l)}>
                  Edit
                </button>
              </div>
              {options.map((o) => (
                <p key={o.id} className="text-xs text-ink-400">
                  + {o.name}
                  {o.priceDelta > 0 && ` (${rupiah(o.priceDelta)})`}
                </p>
              ))}
            </div>
          )
        })}
        {cart.length === 0 && <p className="py-4 text-center text-sm text-ink-400">Keranjang kosong.</p>}
      </div>

      <div className="mb-5 rounded-2xl border border-[#E7D9C7] bg-white">
        <div className="space-y-1.5 p-4 text-sm text-ink-300">
          <div className="flex justify-between">
            <span>Subtotal ({itemCount} Item)</span>
            <span>{rupiah(subtotal)}</span>
          </div>
          {serviceCharge > 0 && (
            <div className="flex justify-between">
              <span>Layanan ({menu.fiscal.serviceChargePercent}%)</span>
              <span>{rupiah(serviceCharge)}</span>
            </div>
          )}
          {tax > 0 && (
            <div className="flex justify-between">
              <span>PPN ({menu.fiscal.taxPercent}%)</span>
              <span>{rupiah(tax)}</span>
            </div>
          )}
        </div>
        <div className="flex justify-between rounded-b-2xl bg-[#F5EEE3] px-4 py-3 text-sm font-bold text-ink-50">
          <span>Total</span>
          <span>{rupiah(total)}</span>
        </div>
      </div>

      <p className="mb-2 text-sm font-semibold text-ink-50">Metode Pembayaran</p>
      <div className="mb-5 flex gap-2">
        {PAYMENT_METHOD_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setPaymentMethod(t.value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-xs font-semibold ${
              paymentMethod === t.value ? 'bg-[#3E2B21] text-white' : 'border border-[#E7D9C7] bg-white text-[#5B4636]'
            }`}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {submitErr && <p className="mb-3 rounded-lg bg-red-900 px-3 py-2 text-sm text-red-500">{submitErr}</p>}

      <button
        className="flex min-h-touch w-full items-center justify-center rounded-xl bg-[#3E2B21] text-base font-semibold text-white disabled:opacity-40"
        disabled={!valid || submitting}
        onClick={onSubmit}
      >
        {submitting ? 'Memproses…' : 'Bayar Sekarang'}
      </button>
    </Screen>
  )
}

const STATUS_STEPS: { key: string; label: string }[] = [
  { key: 'PENDING_CONFIRMATION', label: 'Menunggu konfirmasi kasir' },
  { key: 'CONFIRMED', label: 'Diterima — disiapkan' },
  { key: 'PREPARING', label: 'Sedang dibuat' },
  { key: 'READY', label: 'Siap' },
  { key: 'SERVED', label: 'Diantar' },
  { key: 'COMPLETED', label: 'Selesai' },
]

interface OrderStatus {
  business: { name: string; logoDataUrl: string | null }
  orderNumber: string
  status: string
  queueNumber: number | null
  rejectedReason: string | null
  customerName: string
  subtotal: number
  discountAmount: number
  serviceChargeAmount: number
  taxAmount: number
  roundingAdjustment: number
  grandTotal: number
  paid: boolean
  paidAmount: number
  paymentMethods: string[]
  items: { name: string; qty: number; modifiers: string[]; note: string; lineTotal: number }[]
}

const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' }

/** Cermin dari PAYABLE_STATUSES di backend/src/routes/midtransPay.ts — order
 * boleh dibayar online sejak dikirim, tak perlu menunggu konfirmasi kasir. */
const PAYABLE_STATUSES = new Set(['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'])

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value < 0 ? '−' : ''}{rupiah(Math.abs(value))}</span>
    </div>
  )
}

interface QrisCharge {
  qrDataUrl: string
  grossAmount: number
  expiryTime: string | null
}

function PayQrisPanel({
  token,
  orderId,
  amountDue,
  autoStart = false,
}: {
  token: string
  orderId: string
  amountDue: number
  /** Mulai QRIS otomatis begitu panel ini muncul — dipakai saat pelanggan
   *  memilih "Pembayaran Online" di layar checkout, supaya tak perlu tap lagi. */
  autoStart?: boolean
}) {
  const [charge, setCharge] = useState<QrisCharge | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoStarted = useRef(false)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API}/api/t/${encodeURIComponent(token)}/orders/${encodeURIComponent(orderId)}/pay`, { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Gagal memulai pembayaran QRIS.')
      const qrDataUrl = await QRCode.toDataURL(String(body.qrString), { width: 280, margin: 1 })
      setCharge({ qrDataUrl, grossAmount: Number(body.grossAmount) || amountDue, expiryTime: body.expiryTime ?? null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memulai pembayaran QRIS.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoStart && !autoStarted.current) {
      autoStarted.current = true
      void start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  if (!charge) {
    return (
      <div className="mt-3 border-t border-ink-800 pt-3">
        {error && <p className="mb-2 rounded-lg bg-red-900 px-3 py-2 text-xs text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={loading} onClick={() => void start()}>
          {loading ? 'Menyiapkan QRIS…' : `Bayar Sekarang dengan QRIS · ${rupiah(amountDue)}`}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 border-t border-ink-800 pt-3 text-center">
      <img src={charge.qrDataUrl} alt="Kode QRIS pembayaran" className="mx-auto h-52 w-52 rounded-xl bg-white p-2" />
      <p className="mt-2 text-sm font-bold text-ink-100">{rupiah(charge.grossAmount)}</p>
      <p className="mt-1 text-xs text-ink-400">
        Pindai dengan aplikasi e-wallet atau mobile banking Anda. Halaman ini otomatis diperbarui begitu pembayaran diterima.
      </p>
      <button className="btn-ghost mt-2 w-full text-xs" onClick={() => setCharge(null)}>
        QR kedaluwarsa? Buat QR Baru
      </button>
    </div>
  )
}

function StatusPage() {
  const { token = '', id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const autopay = searchParams.get('autopay') === '1'
  const [data, setData] = useState<OrderStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [callSent, setCallSent] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/t/${encodeURIComponent(token)}/orders/${encodeURIComponent(id)}`)
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Status tidak dapat dimuat.')
      if (!Array.isArray(body.items)) throw new Error('Status tidak dapat dimuat.')
      setData(body)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal memuat status.')
    }
  }, [token, id])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
  }, [load])

  async function call(type: 'waiter' | 'bill') {
    setCallSent(null)
    try {
      const r = await fetch(`${API}/api/t/${encodeURIComponent(token)}/calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (!r.ok) throw new Error()
      setCallSent(type === 'waiter' ? 'Waiter dipanggil.' : 'Permintaan tagihan terkirim.')
    } catch {
      setCallSent('Gagal mengirim. Coba lagi.')
    }
  }

  if (err && !data) return <Center>{err}</Center>
  if (!data) return <Center>Memuat status…</Center>

  const rejected = data.status === 'REJECTED'
  const activeIdx = STATUS_STEPS.findIndex((s) => s.key === data.status)

  return (
    <Screen>
      <header className="mb-5 flex flex-col items-center pt-2 text-center">
        {data.business.logoDataUrl ? (
          <img src={data.business.logoDataUrl} alt={data.business.name} className="h-12 w-12 rounded-xl object-cover" />
        ) : (
          <p className="text-sm font-semibold text-ink-300">{data.business.name}</p>
        )}
        <h1 className="mt-2 text-xl font-bold">Pesanan {data.orderNumber}</h1>
        {data.queueNumber != null && (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1 text-sm font-semibold text-white">
            Antrean #{data.queueNumber}
          </span>
        )}
      </header>

      {rejected ? (
        <div className="card border-red-300/50 p-4">
          <p className="font-semibold text-red-500">Pesanan ditolak</p>
          <p className="mt-1 text-sm text-ink-200">{data.rejectedReason || 'Hubungi kasir untuk info lebih lanjut.'}</p>
        </div>
      ) : (
        <ol className="card space-y-1 p-2">
          {STATUS_STEPS.map((s, i) => {
            const done = activeIdx >= 0 && i < activeIdx
            const now = i === activeIdx
            return (
              <li
                key={s.key}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                  now ? 'bg-brand-600/12 font-semibold text-ink-50' : done ? 'text-ink-300' : 'text-ink-400'
                }`}
              >
                <span
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold ${
                    done ? 'bg-success-500 text-white' : now ? 'bg-brand-600 text-white' : 'bg-ink-800 text-ink-400'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                {s.label}
              </li>
            )
          })}
        </ol>
      )}

      <div className="mt-5 card p-4">
        <p className="mb-2 text-sm font-semibold text-ink-200">{data.paid ? 'Struk' : 'Pesanan Anda'}</p>
        {data.items.map((it, i) => (
          <div key={i} className="mb-1 text-sm">
            <div className="flex justify-between text-ink-300">
              <span>{it.qty}× {it.name}</span>
              <span>{rupiah(it.lineTotal)}</span>
            </div>
            {it.modifiers.length > 0 && <div className="text-xs text-ink-400">{it.modifiers.join(', ')}</div>}
            {it.note && <div className="text-xs italic text-ink-400">"{it.note}"</div>}
          </div>
        ))}
        <div className="mt-2 space-y-0.5 border-t border-ink-800 pt-2 text-sm text-ink-300">
          <Line label="Subtotal" value={data.subtotal} />
          {data.discountAmount > 0 && <Line label="Diskon" value={-data.discountAmount} />}
          {data.serviceChargeAmount > 0 && <Line label="Layanan" value={data.serviceChargeAmount} />}
          {data.taxAmount > 0 && <Line label="Pajak" value={data.taxAmount} />}
          {data.roundingAdjustment !== 0 && <Line label="Pembulatan" value={data.roundingAdjustment} />}
          <div className="flex justify-between border-t border-ink-800 pt-1 font-bold text-ink-100">
            <span>Total</span>
            <span>{rupiah(data.grandTotal)}</span>
          </div>
        </div>
        {data.paid ? (
          <p className="mt-2 text-xs text-success-400">
            LUNAS — {rupiah(data.paidAmount)}
            {data.paymentMethods.length > 0 && ` (${data.paymentMethods.map((m) => METHOD_LABEL[m] ?? m).join(', ')})`}
          </p>
        ) : PAYABLE_STATUSES.has(data.status) ? (
          <>
            <p className="mt-2 text-xs text-ink-400">Bayar di kasir, atau bayar sekarang lewat QRIS di bawah.</p>
            <PayQrisPanel token={token} orderId={id} amountDue={Math.max(0, data.grandTotal - data.paidAmount)} autoStart={autopay} />
          </>
        ) : (
          <p className="mt-2 text-xs text-ink-400">Bayar di kasir setelah pesanan dikonfirmasi.</p>
        )}
      </div>

      {!rejected && (
        <div className="mt-5 space-y-2">
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => void call('waiter')}>
              Panggil Waiter
            </button>
            <button className="btn-secondary flex-1" onClick={() => void call('bill')}>
              Minta Tagihan
            </button>
          </div>
          <Link to={`/order/${token}`} className="btn-ghost w-full">
            Tambah Pesanan
          </Link>
          {callSent && <p className="text-center text-sm text-success-400">{callSent}</p>}
        </div>
      )}
      <KioneFooter />
    </Screen>
  )
}
