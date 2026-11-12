import { accountInitials, avatarClassFor } from '@/features/auth/avatarColors'

const SIZES = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-16 w-16 text-xl',
  lg: 'h-24 w-24 text-3xl',
} as const

export interface AccountAvatarProps {
  name: string
  photoDataUrl?: string | null
  size?: keyof typeof SIZES
  className?: string
}

/** Foto profil pengguna, atau inisial di lingkaran berwarna tetap per nama bila belum ada foto. */
export function AccountAvatar({ name, photoDataUrl, size = 'md', className = '' }: AccountAvatarProps) {
  if (photoDataUrl) {
    return <img src={photoDataUrl} alt="" aria-hidden="true" className={`${SIZES[size]} flex-none rounded-full object-cover ${className}`} />
  }
  return (
    <span aria-hidden="true" className={`${SIZES[size]} flex flex-none items-center justify-center rounded-full font-bold text-white ${avatarClassFor(name)} ${className}`}>
      {accountInitials(name)}
    </span>
  )
}
