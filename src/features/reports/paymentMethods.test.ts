import { describe, expect, it } from 'vitest'
import { featuresForBusinessType } from '@/lib/businessType'
import { paymentMethodRows } from './paymentMethods'

describe('paymentMethodRows', () => {
  const kantin = featuresForBusinessType('kantin').paymentMethods

  it('kantin: Tunai, QRIS, Transfer selalu tampil sesuai urutan layar bayar', () => {
    const rows = paymentMethodRows({ scope: 'all', byPaymentMethod: [{ method: 'qris', amount: 30000, count: 2 }] }, kantin)
    expect(rows).toEqual([
      { method: 'cash', amount: 0, count: 0 },
      { method: 'qris', amount: 30000, count: 2 },
      { method: 'transfer', amount: 0, count: 0 },
    ])
  })

  it('metode di luar daftar yang punya transaksi tetap tampil di akhir', () => {
    const rows = paymentMethodRows({ scope: 'all', byPaymentMethod: [{ method: 'card', amount: 10000, count: 1 }] }, kantin)
    expect(rows.map((r) => r.method)).toEqual(['cash', 'qris', 'transfer', 'card'])
  })

  it('laporan online tidak ditambah metode kosong', () => {
    const byPaymentMethod = [{ method: 'platform' as const, amount: 50000, count: 1 }]
    expect(paymentMethodRows({ scope: 'online', byPaymentMethod }, kantin)).toEqual(byPaymentMethod)
  })
})
