/** Foto sales tim marketing, atau inisial namanya bila belum ada foto. */
export function SalesAvatar({ name, photo, size = 40 }: { name: string; photo: string | null; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  const style = { width: size, height: size }
  if (photo) return <img src={photo} alt={name} style={style} className="flex-none rounded-full object-cover" />
  return (
    <span style={{ ...style, fontSize: size * 0.38 }} className="flex flex-none items-center justify-center rounded-full bg-brand-600/20 font-bold text-brand-400">
      {initials || '?'}
    </span>
  )
}
