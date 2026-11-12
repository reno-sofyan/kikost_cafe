import type { ReactElement } from 'react'
import type { SplashIcon, SplashStyle } from '@/lib/bootSplash'

/**
 * Splash in-app Kione POS. Animasi hanya transform/opacity/stroke (ringan di tablet
 * murah) dan dimatikan oleh `prefers-reduced-motion` di index.css. Gaya mengikuti POS:
 * kanvas terang + indigo (kafe, kantin, laundry) atau latar biru ritel (minimarket).
 */
export function SplashScreen({
  style,
  leaving,
  slow,
  error,
  onRetry,
}: {
  style: SplashStyle
  leaving: boolean
  slow: boolean
  error: { title: string; detail: string } | null
  onRetry: () => void
}) {
  const retail = style.variant === 'retail'
  return (
    <div
      className={`kione-splash fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center ${
        retail ? 'bg-brand-600 text-white' : 'bg-ink-950 text-ink-50'
      } ${leaving ? 'kione-splash--leaving' : ''}`}
      role={error ? 'alertdialog' : 'status'}
      aria-live="polite"
      aria-label={error ? error.title : 'Memuat Kione POS'}
    >
      <KioneMark retail={retail} />

      <div className="kione-splash__text mt-6 flex flex-col items-center gap-2">
        {/* Yang ditonjolkan aplikasinya (Kione POS), bukan nama usaha. */}
        <p className={`font-display text-2xl font-bold tracking-tight ${retail ? 'text-white' : 'text-ink-50'}`}>
          Kione <span className={retail ? 'text-white/80' : 'text-brand-600'}>POS</span>
        </p>
        {style.label && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
              retail ? 'bg-white/15 text-white' : 'bg-brand-600/15 text-brand-400'
            }`}
          >
            <TypeIcon name={style.icon} />
            {style.label}
          </span>
        )}
      </div>

      <div className="mt-10 flex min-h-[4.5rem] flex-col items-center justify-start">
        {error ? (
          <div className={`max-w-sm rounded-2xl p-4 text-left ${retail ? 'bg-white text-ink-50' : 'card'}`}>
            <p className="font-semibold text-red-400">{error.title}</p>
            <p className="mt-1 text-sm text-ink-200">{error.detail}</p>
            <button className="btn-primary mt-3 w-full" onClick={onRetry} autoFocus>
              Coba lagi
            </button>
          </div>
        ) : (
          <>
            <span className={`kione-splash__bar ${retail ? 'bg-white/25' : 'bg-brand-600/15'}`} aria-hidden="true">
              <span className={retail ? 'bg-white' : 'bg-brand-600'} />
            </span>
            <p className={`mt-3 text-sm transition-opacity ${slow ? 'opacity-100' : 'opacity-0'} ${retail ? 'text-white/85' : 'text-ink-300'}`}>
              Menyiapkan data lokal…
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/** Logo "K" Kione sebagai SVG: ubin muncul (fade + scale), lalu goresan K tergambar. */
function KioneMark({ retail }: { retail: boolean }) {
  return (
    <svg className="kione-splash__mark" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
      <defs>
        <linearGradient id="kione-splash-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--kione-brand-500))" />
          <stop offset="1" stopColor="rgb(var(--kione-brand-600))" />
        </linearGradient>
      </defs>
      <rect className="kione-splash__tile" x="2" y="2" width="92" height="92" rx="22" fill={retail ? '#ffffff' : 'url(#kione-splash-tile)'} />
      <g fill="none" strokeLinecap="round" strokeWidth="10" stroke={retail ? 'rgb(var(--kione-brand-600))' : '#ffffff'}>
        <path className="kione-splash__stroke" pathLength="1" d="M33 30 V68" />
        <path className="kione-splash__stroke kione-splash__stroke--2" pathLength="1" d="M66 27 L41 49" />
        <path className="kione-splash__stroke kione-splash__stroke--3" pathLength="1" d="M44 52 L66 70" opacity="0.6" />
      </g>
    </svg>
  )
}

/** Ikon jenis usaha (garis 2px, gaya sama dengan ikon aplikasi). */
function TypeIcon({ name }: { name: SplashIcon }) {
  const paths: Record<SplashIcon, ReactElement> = {
    coffee: (
      <>
        <path d="M4 10h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
        <path d="M16 12h1.5a2.5 2.5 0 0 1 0 5H16" />
        <path d="M8 3v3M12 3v3" />
      </>
    ),
    bowl: (
      <>
        <path d="M3 12h18a9 9 0 0 1-18 0z" />
        <path d="M8 8c0-2 2-2 2-4M13 8c0-2 2-2 2-4" />
      </>
    ),
    cart: (
      <>
        <path d="M3 4h2l2.4 11h10.2L20 8H6.2" />
        <circle cx="9" cy="19" r="1.4" />
        <circle cx="17" cy="19" r="1.4" />
      </>
    ),
    washer: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="13" r="4.5" />
        <path d="M7.5 6.5h1M11 6.5h1" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
