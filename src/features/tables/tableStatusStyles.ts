import type { TableStatus } from '@/types/domain'

export const STATUS_COLORS: Record<TableStatus, string> = {
  available: 'bg-ink-900 border-ink-600 text-ink-300 hover:border-brew-500',
  occupied: 'bg-brew-600 border-brew-600 text-cream-50 shadow-sm',
  awaiting_payment: 'bg-yellow-900 border-yellow-600 text-yellow-500',
  needs_cleaning: 'bg-red-900 border-red-300 text-red-500',
}

export const STATUS_DOT: Record<TableStatus, string> = {
  available: 'bg-ink-400',
  occupied: 'bg-cream-50',
  awaiting_payment: 'bg-yellow-600',
  needs_cleaning: 'bg-red-500',
}
