import { clearOrderHppPricing } from '@/db/repositories/hppPricing'
import { HPP_PRICING_LABELS } from '@/lib/hppPricing'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Order } from '@/types/domain'

/**
 * Status KOL / Compliment / Kalibrasi di keranjang kasir (kafe). Jenisnya dipilih di
 * dialog Pesanan Baru; di sini hanya ditampilkan, dan bisa dilepas (kembali ke harga jual).
 */
export function HppPricingControl({ order }: { order: Order }) {
  const user = useSessionStore((s) => s.currentUser)!
  const actor = { userId: user.id, userName: user.name }
  const pricing = order.hppPricing
  const paid = order.status !== 'open'

  if (pricing) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-500/10 px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-semibold text-ink-50">
            {HPP_PRICING_LABELS[pricing.kind]} — {pricing.name}
          </span>
          <span className="block truncate text-xs text-ink-300">Harga HPP • oleh {pricing.approvedByName}</span>
        </span>
        {!paid && (
          <button
            className="flex-none text-xs font-semibold text-red-400"
            onClick={() =>
              void clearOrderHppPricing(order.id, actor)
                .then(() => toast.success('Kembali ke harga jual normal.'))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Gagal melepas.'))
            }
          >
            Lepas
          </button>
        )}
      </div>
    )
  }
  return null
}
