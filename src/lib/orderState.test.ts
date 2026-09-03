import { describe, expect, it } from 'vitest'
import {
  assertTransition,
  canTransition,
  deriveKitchenPhase,
  InvalidOrderTransitionError,
  legacyStatusFor,
} from './orderState'

describe('orderState — validasi transisi', () => {
  it('mengizinkan alur maju normal', () => {
    expect(canTransition('DRAFT', 'CONFIRMED')).toBe(true)
    expect(canTransition('CONFIRMED', 'PREPARING')).toBe(true)
    expect(canTransition('PREPARING', 'READY')).toBe(true)
    expect(canTransition('READY', 'SERVED')).toBe(true)
    expect(canTransition('SERVED', 'COMPLETED')).toBe(true)
  })

  it('mengizinkan loncatan maju yang sah', () => {
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(true) // takeaway bayar di muka
    expect(canTransition('COMPLETED', 'VOIDED')).toBe(true) // koreksi supervisor
  })

  it('menolak transisi mundur & keluar status final', () => {
    expect(canTransition('PREPARING', 'DRAFT')).toBe(false)
    expect(canTransition('COMPLETED', 'PREPARING')).toBe(false)
    expect(canTransition('VOIDED', 'CONFIRMED')).toBe(false)
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false)
  })

  it('assertTransition melempar untuk transisi tidak sah', () => {
    expect(() => assertTransition('READY', 'DRAFT')).toThrow(InvalidOrderTransitionError)
    expect(() => assertTransition('DRAFT', 'CONFIRMED')).not.toThrow()
  })

  it('memetakan lifecycle → status legacy', () => {
    expect(legacyStatusFor('DRAFT')).toBe('open')
    expect(legacyStatusFor('PREPARING')).toBe('open')
    expect(legacyStatusFor('COMPLETED')).toBe('paid')
    expect(legacyStatusFor('VOIDED')).toBe('void')
    expect(legacyStatusFor('CANCELLED')).toBe('void')
  })

  it('pesanan QR: PENDING_CONFIRMATION → CONFIRMED / REJECTED', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'CONFIRMED')).toBe(true)
    expect(canTransition('PENDING_CONFIRMATION', 'REJECTED')).toBe(true)
    expect(canTransition('PENDING_CONFIRMATION', 'COMPLETED')).toBe(false)
    expect(canTransition('REJECTED', 'CONFIRMED')).toBe(false)
    expect(legacyStatusFor('PENDING_CONFIRMATION')).toBe('open')
    expect(legacyStatusFor('REJECTED')).toBe('void')
  })

  it('deriveKitchenPhase tidak menggerakkan pesanan yang belum dikonfirmasi', () => {
    expect(deriveKitchenPhase('PENDING_CONFIRMATION', ['new'])).toBe('PENDING_CONFIRMATION')
  })
})

describe('deriveKitchenPhase', () => {
  it('CONFIRMED tanpa aktivitas dapur', () => {
    expect(deriveKitchenPhase('CONFIRMED', [])).toBe('CONFIRMED')
    expect(deriveKitchenPhase('CONFIRMED', ['new', 'new'])).toBe('CONFIRMED')
  })
  it('PREPARING bila ada item diproses', () => {
    expect(deriveKitchenPhase('CONFIRMED', ['new', 'in_progress'])).toBe('PREPARING')
  })
  it('READY bila semua item siap/selesai', () => {
    expect(deriveKitchenPhase('PREPARING', ['ready', 'ready'])).toBe('READY')
    expect(deriveKitchenPhase('PREPARING', ['ready', 'done'])).toBe('READY')
  })
  it('SERVED bila semua item selesai', () => {
    expect(deriveKitchenPhase('READY', ['done', 'done'])).toBe('SERVED')
  })
  it('tidak menyentuh status final atau DRAFT', () => {
    expect(deriveKitchenPhase('COMPLETED', ['done'])).toBe('COMPLETED')
    expect(deriveKitchenPhase('DRAFT', ['new'])).toBe('DRAFT')
  })
})
