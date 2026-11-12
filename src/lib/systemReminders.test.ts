import { describe, expect, it } from 'vitest'
import { lowStockMessage, newlyLowStock, qrOrderReminder } from './systemReminders'
import { nextReminderAt } from './shiftReminder'

describe('notifikasi sistem', () => {
  it('pesanan QR: hanya saat bertambah & aplikasi di latar belakang', () => {
    expect(qrOrderReminder(null, 2, true)).toBeNull()
    expect(qrOrderReminder(1, 2, false)).toBeNull()
    expect(qrOrderReminder(2, 1, true)).toBeNull()
    expect(qrOrderReminder(0, 1, true)).toBe('1 pesanan QR menunggu konfirmasi kasir.')
    expect(qrOrderReminder(1, 3, true)).toBe('3 pesanan QR menunggu konfirmasi kasir.')
  })
  it('stok: hanya yang baru menipis, bukan yang sudah menipis saat aplikasi dibuka', () => {
    const a = { id: 'p:1', name: 'Croffle' }
    const b = { id: 'i:2', name: 'Susu' }
    expect(newlyLowStock(null, [a])).toEqual([])
    expect(newlyLowStock(new Set(['p:1']), [a, b])).toEqual([b])
    expect(lowStockMessage([a, b, a, b])).toBe('Stok menipis: Croffle, Susu, Croffle dan 1 lainnya. Cek Daftar Belanja / Stok.')
  })
  it('pengingat shift berikutnya selalu 21.00 WIB setelah sekarang', () => {
    const now = Date.UTC(2026, 10, 12, 10, 0) // 17.00 WIB
    expect(new Date(nextReminderAt(now)).toISOString()).toBe('2026-11-12T14:00:00.000Z')
    const late = Date.UTC(2026, 10, 12, 15, 0) // 22.00 WIB
    expect(new Date(nextReminderAt(late)).toISOString()).toBe('2026-11-13T14:00:00.000Z')
  })
})
