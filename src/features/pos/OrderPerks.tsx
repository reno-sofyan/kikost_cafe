import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { setOrderCustomer, setOrderPointsRedeem, setOrderVoucher } from '@/db/repositories/orders'
import { createCustomer, searchCustomers } from '@/db/repositories/customers'
import { getCustomerLoyalty } from '@/db/repositories/loyalty'
import { depositEnabledFor, getCustomerDeposit } from '@/db/repositories/deposits'
import { getSettings } from '@/db/repositories/settings'
import { loyaltySettingsOf } from '@/lib/loyalty'
import { isBirthdayAt } from '@/lib/promos'
import { formatNumber, formatRupiah } from '@/lib/currency'
import type { BusinessFeatures } from '@/lib/businessType'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/state/toastStore'
import type { Order } from '@/types/domain'

/**
 * Baris "Member" & "Voucher" di keranjang kasir (kafe & restoran): mengaitkan
 * pelanggan member, menukar poin, dan memasang kode voucher. Promo otomatis tak
 * butuh tombol — langsung muncul di rincian total.
 */
export function OrderPerks({ order, features }: { order: Order; features: BusinessFeatures }) {
  const [showMember, setShowMember] = useState(false)
  const [showVoucher, setShowVoucher] = useState(false)
  const [showRedeem, setShowRedeem] = useState(false)
  const loyalty = useLiveQuery(async () => loyaltySettingsOf(await getSettings()), [])
  const customer = useLiveQuery(async () => (order.customerId ? ((await db.customers.get(order.customerId)) ?? null) : null), [order.customerId])
  const info = useLiveQuery(
    () => (order.customerId ? getCustomerLoyalty(order.customerId, order.id) : undefined),
    [order.customerId, order.id, order.pointsRedeemed],
  )

  const depositBalance = useLiveQuery(
    async () => (order.customerId && depositEnabledFor(await getSettings()) ? (await getCustomerDeposit(order.customerId)).balance : 0),
    [order.customerId],
  )

  const memberOn = features.loyalty && !!loyalty?.enabled
  if (!features.promos && !memberOn && !order.customerId) return null
  const voucher = order.appliedPromos?.find((p) => p.voucherCode)

  return (
    <div className="space-y-1.5 pb-1">
      {(memberOn || customer) && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <button className="flex min-w-0 items-center gap-1.5 text-ink-200 underline-offset-2 hover:underline" onClick={() => setShowMember(true)}>
            <Icon name="user" size={14} className="flex-none" />
            <span className="truncate">
              {customer ? customer.name : 'Tambah member'}
              {customer && memberOn && info ? ` • ${info.tier.name} • ${formatNumber(info.available)} poin` : ''}
              {customer && depositBalance ? ` • saldo ${formatRupiah(depositBalance)}` : ''}
              {customer && isBirthdayAt(customer.birthDate, Date.now(), 'month') ? ' • ulang tahun bulan ini' : ''}
            </span>
          </button>
          {customer && memberOn && info && loyalty && (
            <button
              className="flex-none rounded-lg bg-accent-500/15 px-2 py-1 text-xs font-semibold text-accent-500 disabled:opacity-40"
              disabled={!order.pointsRedeemed && info.available < loyalty.minRedeem}
              title={info.available < loyalty.minRedeem ? `Minimal tukar ${loyalty.minRedeem} poin` : undefined}
              onClick={() => setShowRedeem(true)}
            >
              {order.pointsRedeemed ? `Tukar ${order.pointsRedeemed} poin ✎` : 'Tukar Poin'}
            </button>
          )}
        </div>
      )}
      {features.promos && (
        <div className="flex items-center justify-between gap-2 text-sm">
          {voucher ? (
            <>
              <span className="truncate text-ink-200">
                Voucher <span className="font-semibold">{voucher.voucherCode}</span>
              </span>
              <button
                className="flex-none text-xs font-semibold text-red-400"
                onClick={() => void setOrderVoucher(order.id, null).then(() => toast.success('Voucher dilepas.'))}
              >
                Lepas
              </button>
            </>
          ) : (
            <button className="text-ink-300 underline-offset-2 hover:underline" onClick={() => setShowVoucher(true)}>
              + Kode voucher
            </button>
          )}
        </div>
      )}

      {showMember && <MemberPickerModal order={order} onClose={() => setShowMember(false)} />}
      {showVoucher && <VoucherModal orderId={order.id} onClose={() => setShowVoucher(false)} />}
      {showRedeem && info && loyalty && (
        <RedeemModal order={order} available={info.available} pointValue={loyalty.pointValue} minRedeem={loyalty.minRedeem} onClose={() => setShowRedeem(false)} />
      )}
    </div>
  )
}

function MemberPickerModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const results = useLiveQuery(() => searchCustomers(query), [query]) ?? []

  async function pick(customerId: string | null) {
    await setOrderCustomer(order.id, customerId)
    onClose()
  }

  return (
    <Modal onClose={onClose} className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-3 text-lg font-bold text-ink-50">Member</h2>
      {adding ? (
        <>
          <input className="input-field mb-3" autoFocus placeholder="Nama" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="input-field mb-4" inputMode="tel" placeholder="No. HP" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <div className="flex gap-3">
            <button className="btn-ghost flex-1" onClick={() => setAdding(false)}>
              Kembali
            </button>
            <button
              className="btn-primary flex-[2]"
              disabled={!newName.trim()}
              onClick={async () => {
                const created = await createCustomer({ name: newName.trim(), phone: newPhone.trim(), note: '' })
                await pick(created.id)
              }}
            >
              Daftarkan & Pilih
            </button>
          </div>
        </>
      ) : (
        <>
          <input className="input-field mb-3" autoFocus placeholder="Cari nama / no. HP" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mb-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
            {results.slice(0, 30).map((c) => (
              <button
                key={c.id}
                className={`block w-full rounded-xl border p-3 text-left ${c.id === order.customerId ? 'border-brand-600 bg-brand-600/15' : 'border-ink-800 bg-ink-800'}`}
                onClick={() => void pick(c.id)}
              >
                <span className="font-semibold text-ink-50">{c.name}</span>
                <span className="ml-2 text-sm text-ink-400">{c.phone}</span>
              </button>
            ))}
            {results.length === 0 && <p className="py-4 text-center text-sm text-ink-500">Tidak ditemukan.</p>}
          </div>
          <div className="flex gap-3">
            {order.customerId && (
              <button className="btn-ghost flex-1 !text-red-400" onClick={() => void pick(null)}>
                Lepas Member
              </button>
            )}
            <button className="btn-secondary flex-1" onClick={() => setAdding(true)}>
              + Member Baru
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function VoucherModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      const applied = await setOrderVoucher(orderId, code)
      toast.success(applied ? `Voucher ${applied.voucherCode} terpasang: −${formatRupiah(applied.amount)}` : 'Voucher terpasang.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voucher tidak bisa dipakai.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Kode Voucher</h2>
      <p className="mb-3 text-sm text-ink-400">Masukkan kode dari pelanggan (termasuk kode KOL/influencer).</p>
      <input
        className="input-field mb-2 uppercase tracking-wider"
        autoFocus
        aria-label="Kode voucher"
        placeholder="mis. HEMAT20"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && code.trim()) void apply()
        }}
      />
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="mt-2 flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !code.trim()} onClick={() => void apply()}>
          Pasang Voucher
        </button>
      </div>
    </Modal>
  )
}

function RedeemModal({ order, available, pointValue, minRedeem, onClose }: { order: Order; available: number; pointValue: number; minRedeem: number; onClose: () => void }) {
  // Tak ada gunanya menukar lebih dari nilai tagihan sebelum potongan poin.
  const otherDiscount = order.discountAmount - (order.pointsRedeemed ?? 0) * (order.pointsRedeemValue ?? 0)
  const maxUseful = Math.min(available, Math.ceil(Math.max(0, order.subtotal - otherDiscount) / pointValue))
  const [points, setPoints] = useState(order.pointsRedeemed || Math.max(minRedeem, 0))
  const [error, setError] = useState<string | null>(null)

  async function apply(value: number) {
    setError(null)
    try {
      await setOrderPointsRedeem(order.id, value)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menukar poin.')
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Tukar Poin</h2>
      <p className="mb-3 text-sm text-ink-400">
        Tersedia {formatNumber(available)} poin • 1 poin = {formatRupiah(pointValue)} • minimal {minRedeem} poin
      </p>
      <label className="mb-2 block">
        <span className="mb-1 block text-sm text-ink-300">Jumlah poin</span>
        <input
          type="number"
          className="input-field"
          min={0}
          max={maxUseful}
          autoFocus
          value={points}
          onChange={(e) => setPoints(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
      </label>
      <div className="mb-3 flex items-center justify-between text-sm">
        <button className="text-brand-400 underline-offset-2 hover:underline" onClick={() => setPoints(maxUseful)}>
          Pakai maksimal ({formatNumber(maxUseful)})
        </button>
        <span className="font-semibold text-ink-100">Potongan {formatRupiah(points * pointValue)}</span>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        {order.pointsRedeemed ? (
          <button className="btn-secondary flex-1" onClick={() => void apply(0)}>
            Batal Tukar
          </button>
        ) : null}
        <button className="btn-primary flex-[2]" disabled={points <= 0} onClick={() => void apply(points)}>
          Tukar
        </button>
      </div>
    </Modal>
  )
}
