import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Route, Routes, useNavigate, useParams } from 'react-router-dom'

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
  price: number
  photoDataUrl: string | null
  modifierGroups: MenuGroup[]
}
interface Menu {
  cafe: { name: string; address: string; phone: string }
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

const rupiah = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-ink-950 text-ink-50">
      <div className="mx-auto max-w-md px-4 pb-40 pt-5">{children}</div>
    </div>
  )
}

function Center({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <div className="mt-24 text-center text-ink-200">{children}</div>
    </Screen>
  )
}

export function CustomerApp() {
  return (
    <Routes>
      <Route path="/order/:token" element={<MenuPage />} />
      <Route path="/order/:token/status/:id" element={<StatusPage />} />
      <Route path="*" element={<Center>Halaman tidak ditemukan.</Center>} />
    </Routes>
  )
}

function MenuPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState<CartLine[]>([])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [activeCat, setActiveCat] = useState<string>('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`${API}/api/t/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || 'Menu tidak dapat dimuat.')
        return body as Menu
      })
      .then((m) => {
        if (!alive) return
        setMenu(m)
        setActiveCat(m.categories[0]?.id ?? '')
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token])

  const subtotal = useMemo(
    () =>
      cart.reduce((sum, l) => {
        const mods = l.optionIds.reduce((s, oid) => {
          for (const g of l.item.modifierGroups) for (const o of g.options) if (o.id === oid) return s + o.priceDelta
          return s
        }, 0)
        return sum + (l.item.price + mods) * l.qty
      }, 0),
    [cart],
  )

  const addLine = useCallback((line: CartLine) => setCart((c) => [...c, line]), [])
  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key))

  async function submit() {
    if (cart.length === 0 || submitting) return
    setSubmitting(true)
    setErr(null)
    const idempotencyKey = `${token}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    try {
      const r = await fetch(`${API}/api/t/${encodeURIComponent(token)}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          customerName: name,
          items: cart.map((l) => ({ productId: l.item.id, qty: l.qty, modifierOptionIds: l.optionIds, note: l.note })),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Pesanan gagal dikirim.')
      navigate(`/order/${token}/status/${body.orderId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Pesanan gagal dikirim.')
      setSubmitting(false)
    }
  }

  if (loading) return <Center>Memuat menu…</Center>
  if (err && !menu) return <Center>{err}</Center>
  if (!menu) return <Center>Menu tidak tersedia.</Center>

  const itemsByCat = menu.items.filter((i) => i.categoryId === activeCat)

  return (
    <Screen>
      <header className="mb-4">
        <h1 className="text-xl font-bold">{menu.cafe.name}</h1>
        <p className="text-sm text-ink-300">{menu.table.name} · pesan langsung dari meja</p>
      </header>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-ink-300">Nama Anda (opsional)</span>
        <input className="input-field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="mis. Budi" />
      </label>

      {menu.categories.length > 1 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {menu.categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={`btn !min-h-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${activeCat === c.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {itemsByCat.map((item) => (
          <button
            key={item.id}
            onClick={() => (item.modifierGroups.length ? setEditing(item) : addLine({ key: crypto.randomUUID(), item, qty: 1, optionIds: [], note: '' }))}
            className="card flex w-full items-center gap-3 p-3 text-left active:scale-[0.99]"
          >
            {item.photoDataUrl && <img src={item.photoDataUrl} alt="" className="h-14 w-14 flex-none rounded-lg object-cover" />}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{item.name}</span>
              <span className="block text-sm text-ink-300">{rupiah(item.price)}</span>
            </span>
            <span className="flex-none rounded-full bg-brew-600 px-2 py-1 text-xs font-bold text-white">+</span>
          </button>
        ))}
        {itemsByCat.length === 0 && <p className="py-8 text-center text-sm text-ink-400">Tidak ada item di kategori ini.</p>}
      </div>

      {editing && (
        <ItemSheet
          item={editing}
          onClose={() => setEditing(null)}
          onAdd={(line) => {
            addLine(line)
            setEditing(null)
          }}
        />
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-700 bg-ink-900 p-4">
          <div className="mx-auto max-w-md">
            <div className="mb-2 max-h-32 space-y-1 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.key} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {l.qty}× {l.item.name}
                    {l.optionIds.length > 0 && <span className="text-ink-400"> · varian</span>}
                  </span>
                  <button className="ml-2 flex-none text-red-400" onClick={() => removeLine(l.key)}>
                    hapus
                  </button>
                </div>
              ))}
            </div>
            {err && <p className="mb-2 text-sm text-red-400">{err}</p>}
            <p className="mb-2 text-xs text-ink-400">
              Subtotal {rupiah(subtotal)}
              {(menu.fiscal.taxPercent > 0 || menu.fiscal.serviceChargePercent > 0) && ' · pajak & layanan dihitung kasir'}
            </p>
            <button className="btn-primary w-full" disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Mengirim…' : `Kirim Pesanan · ${rupiah(subtotal)}`}
            </button>
          </div>
        </div>
      )}
    </Screen>
  )
}

function ItemSheet({ item, onClose, onAdd }: { item: MenuItem; onClose: () => void; onAdd: (l: CartLine) => void }) {
  const [qty, setQty] = useState(1)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [note, setNote] = useState('')

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
    <div className="fixed inset-0 z-30 flex items-end bg-black/50" onClick={onClose}>
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold">{item.name}</h2>
          <button className="text-ink-400" onClick={onClose}>
            tutup
          </button>
        </div>

        {item.modifierGroups.map((g) => (
          <div key={g.id} className="mb-4">
            <p className="mb-1.5 text-sm font-semibold">
              {g.name}
              {g.required && <span className="text-red-400"> *</span>}
              <span className="ml-1 text-xs font-normal text-ink-400">{g.multiSelect ? '(boleh lebih dari satu)' : ''}</span>
            </p>
            <div className="space-y-1.5">
              {g.options.map((o) => {
                const on = (selected[g.id] ?? []).includes(o.id)
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(g, o.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm ${
                      on ? 'border-brew-500 bg-brew-600/15' : 'border-ink-700 bg-ink-800'
                    }`}
                  >
                    <span>{o.name}</span>
                    <span className="text-ink-300">{o.priceDelta ? `+${rupiah(o.priceDelta)}` : ''}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">Catatan (opsional)</span>
          <input className="input-field" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="mis. tanpa gula" />
        </label>

        <div className="mb-4 flex items-center gap-4">
          <button className="btn-secondary !min-h-0 !px-4 !py-2 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <span className="text-lg font-bold">{qty}</span>
          <button className="btn-secondary !min-h-0 !px-4 !py-2 text-lg" onClick={() => setQty((q) => Math.min(99, q + 1))}>
            +
          </button>
        </div>

        <button
          className="btn-primary w-full"
          disabled={missingRequired}
          onClick={() => onAdd({ key: crypto.randomUUID(), item, qty, optionIds, note })}
        >
          {missingRequired ? 'Pilih varian wajib dulu' : `Tambah · ${rupiah((item.price + extra) * qty)}`}
        </button>
      </div>
    </div>
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
  orderNumber: string
  status: string
  queueNumber: number | null
  rejectedReason: string | null
  grandTotal: number
  items: { name: string; qty: number }[]
}

function StatusPage() {
  const { token = '', id = '' } = useParams()
  const [data, setData] = useState<OrderStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [callSent, setCallSent] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/t/${encodeURIComponent(token)}/orders/${encodeURIComponent(id)}`)
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Status tidak dapat dimuat.')
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
      <header className="mb-5">
        <h1 className="text-xl font-bold">Pesanan {data.orderNumber}</h1>
        {data.queueNumber != null && <p className="text-sm text-ink-300">Nomor antrean #{data.queueNumber}</p>}
      </header>

      {rejected ? (
        <div className="card border-red-500/40 p-4">
          <p className="font-semibold text-red-400">Pesanan ditolak</p>
          <p className="mt-1 text-sm text-ink-200">{data.rejectedReason || 'Hubungi kasir untuk info lebih lanjut.'}</p>
        </div>
      ) : (
        <ol className="space-y-2">
          {STATUS_STEPS.map((s, i) => {
            const done = activeIdx >= 0 && i < activeIdx
            const now = i === activeIdx
            return (
              <li
                key={s.key}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                  now ? 'bg-brew-600/15 font-semibold' : done ? 'text-ink-400' : 'text-ink-500'
                }`}
              >
                <span
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs ${
                    done ? 'bg-sage-500 text-white' : now ? 'bg-brew-600 text-white' : 'bg-ink-800'
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
        <p className="mb-2 text-sm font-semibold text-ink-200">Pesanan Anda</p>
        {data.items.map((it, i) => (
          <p key={i} className="text-sm text-ink-300">
            {it.qty}× {it.name}
          </p>
        ))}
        <p className="mt-2 border-t border-ink-800 pt-2 text-sm">Total {rupiah(data.grandTotal)}</p>
        <p className="text-xs text-ink-400">Bayar di kasir.</p>
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
          <a href={`/order/${token}`} className="btn-ghost w-full">
            Tambah Pesanan
          </a>
          {callSent && <p className="text-center text-sm text-sage-400">{callSent}</p>}
        </div>
      )}
    </Screen>
  )
}
