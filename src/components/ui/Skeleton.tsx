/**
 * Kerangka pemuatan (skeleton) selagi data dibaca dari IndexedDB/API. Memakai token
 * warna yang sama dengan kartu & permukaan, jadi otomatis mengikuti tema POS (indigo
 * atau biru ritel). Denyutnya mati bila perangkat meminta "kurangi gerakan".
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-ink-700 motion-reduce:animate-none ${className}`} />
}

/** Grid kartu produk/menu di kasir. `variant="retail"` meniru kartu Minimarket. */
export function ProductGridSkeleton({ count = 9, variant = 'default' }: { count?: number; variant?: 'default' | 'retail' }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          role="presentation"
          className={variant === 'retail' ? 'flex flex-col rounded-2xl border border-ink-600 bg-ink-900 p-3.5' : 'card flex flex-col p-2.5'}
        >
          <Skeleton className={variant === 'retail' ? 'mb-3 aspect-[5/4] w-full rounded-xl' : 'mb-2.5 aspect-[16/10] w-full rounded-lg'} />
          <Skeleton className="mx-1 h-4 w-3/4" />
          <Skeleton className="mx-1 mt-2 h-4 w-1/3" />
        </div>
      ))}
    </>
  )
}

/** Baris daftar transaksi (Riwayat). */
export function TransactionRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} role="presentation" className="card flex w-full items-center justify-between p-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="flex flex-col items-end space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </>
  )
}

/** Tabel generik (laporan, daftar data). */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden" role="presentation">
      <div className="flex gap-4 bg-ink-800 px-4 py-3">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-t border-ink-800 px-4 py-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? '' : 'max-w-[8rem]'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Status "sedang memuat" untuk pembaca layar, dipasang di samping kerangka. */
export function LoadingAnnouncement({ label = 'Memuat data…' }: { label?: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  )
}
