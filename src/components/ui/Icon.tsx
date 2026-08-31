import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'search'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'star'
  | 'table'
  | 'chef'
  | 'clock'
  | 'user'
  | 'wallet'
  | 'chart'
  | 'coffee'
  | 'box'
  | 'cashDrawer'
  | 'settings'
  | 'lock'
  | 'power'
  | 'refresh'
  | 'wifi'
  | 'wifiOff'
  | 'printer'
  | 'cart'
  | 'alertTriangle'
  | 'arrowLeft'
  | 'trash'
  | 'edit'
  | 'image'
  | 'receipt'
  | 'bell'
  | 'checkCircle'
  | 'backspace'
  | 'barcode'

const SHAPES: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 13l4 4L19 7" />,
  star: (
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z" />
  ),
  table: (
    <>
      <path d="M3 8h18l-1.5 3H4.5L3 8Z" />
      <path d="M6 11v9M18 11v9" />
    </>
  ),
  chef: (
    <>
      <circle cx="12" cy="8" r="4.2" />
      <path d="M8 10.5V21h8V10.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="13.5" r="1" />
    </>
  ),
  chart: <path d="M4 20V10M11 20V4M18 20v-7M3 20h18" />,
  coffee: (
    <>
      <path d="M5 9h11a3 3 0 0 1 0 6h-1" />
      <path d="M5 9v7a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V9" />
      <path d="M8 3.5v1.5M11.5 3.5v1.5" />
    </>
  ),
  box: (
    <>
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" />
      <path d="M3 8.5V16l9 4.5m0-12V20.5m9-12V16l-9 4.5" />
    </>
  ),
  cashDrawer: (
    <>
      <rect x="3" y="8" width="18" height="11" rx="1" />
      <path d="M3 8 6 3h12l3 5M9 13.5h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </>
  ),
  refresh: (
    <>
      <path d="M4 4v5h5" />
      <path d="M20 20v-5h-5" />
      <path d="M4.6 15a8 8 0 0 0 14.8 1.8M19.4 9A8 8 0 0 0 4.6 7.2" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8.5a16 16 0 0 1 20 0" />
      <path d="M5.5 12.3a11 11 0 0 1 13 0" />
      <path d="M9 16a6 6 0 0 1 6 0" />
      <circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M2.5 2.5l19 19" />
      <path d="M2 8.5c1.9-1.5 4-2.5 6.3-3M17.7 5.5A16 16 0 0 1 22 8.5" />
      <path d="M5.5 12.3c1-.8 2.1-1.4 3.3-1.8M14.6 11a11 11 0 0 1 4.9 1.3" />
      <path d="M9 16a6 6 0 0 1 4.2-.4" />
      <circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  printer: (
    <>
      <path d="M6.5 9V3.5h11V9" />
      <rect x="3.5" y="9" width="17" height="7.5" rx="1.2" />
      <rect x="6.5" y="14" width="11" height="6.5" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="9" cy="20" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="20" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14 6.5l3 3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M5 17l4.5-5 3 3.2L16.5 11 20 16" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-1-1.5L11 21l-2.5-1.5L6 21V3Z" />
      <path d="M9 8h6M9 11.5h6M9 15h4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.3l2.7 2.7L16.2 9" />
    </>
  ),
  backspace: (
    <>
      <path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-6-6 6-6Z" />
      <path d="M13 10l4 4M17 10l-4 4" />
    </>
  ),
  barcode: (
    <>
      <path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M20.5 5v14" />
    </>
  ),
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {SHAPES[name]}
    </svg>
  )
}
