import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, businessDisplayName, businessInitials } from '@/db/repositories/settings'

/**
 * Merek pemilik usaha (logo + nama dari Pengaturan → Profil Usaha).
 *
 * Dipakai di permukaan operasional yang dilihat pegawai outlet dan pelanggan.
 * Untuk merek produk (Kione POS) pakai konstanta di `@/lib/brand` — lihat
 * penjelasan pembagiannya di sana.
 *
 * Kalau pemilik belum mengunggah logo, inisial nama usaha dipakai sebagai
 * penggantinya. Itu lebih baik daripada menampilkan logo Kione di tempat yang
 * seharusnya milik mereka.
 */

const SIZES = {
  sm: { box: 'h-8 w-8', text: 'text-[0.6rem]', radius: 'rounded-lg' },
  md: { box: 'h-12 w-12', text: 'text-sm', radius: 'rounded-xl' },
  lg: { box: 'h-20 w-20', text: 'text-2xl', radius: 'rounded-2xl' },
} as const

/** Logo usaha, atau inisial namanya bila belum ada logo. */
export function BusinessLogo({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  const settings = useLiveQuery(() => getSettings(), [])
  const name = businessDisplayName(settings)
  const s = SIZES[size]

  if (settings?.logoDataUrl) {
    return <img src={settings.logoDataUrl} alt={name} className={`${s.box} ${s.radius} object-cover ${className}`} />
  }
  return (
    <span
      aria-label={name}
      className={`${s.box} ${s.radius} ${s.text} flex flex-none items-center justify-center bg-brand-600 font-bold text-white ${className}`}
    >
      {businessInitials(name)}
    </span>
  )
}

/** Logo + nama usaha, bertumpuk vertikal. Untuk layar masuk & layar kunci. */
export function BusinessBrand({ size = 'lg' }: { size?: keyof typeof SIZES }) {
  const settings = useLiveQuery(() => getSettings(), [])
  const name = businessDisplayName(settings)
  return (
    <div className="flex flex-col items-center text-center">
      <BusinessLogo size={size} className="mb-4" />
      <h1 className="text-2xl font-bold text-ink-50">{name}</h1>
      {settings?.address ? <p className="mt-1 max-w-xs text-sm text-ink-300">{settings.address}</p> : null}
    </div>
  )
}
