import { describe, expect, it } from 'vitest'
import { buildCancellationReport, describeCancellation } from '../src/lib/opsCancellations.js'

const base = { id: 'o1', orderNumber: 'TRX-1', status: 'void', grandTotal: 20000, cashierName: 'Kasir A', createdAt: 1, voidedAt: 2 }

describe('describeCancellation', () => {
  it('memakai field terstruktur (app ≥ v1.0.13)', () => {
    const row = describeCancellation(
      { ...base, paidAt: 5, voidReason: 'Komplain', voidRequestedByName: 'Kasir A', voidedByName: 'Bu Sari', voidApproval: 'owner_code' },
      [],
    )
    expect(row).toMatchObject({ stage: 'paid', reason: 'Komplain', requestedBy: 'Kasir A', approvedBy: 'Bu Sari', approval: 'owner_code' })
  })

  it('data lama: order.cancel dengan kode Pemilik → peminta = pelaku, penyetuju dari detail', () => {
    const row = describeCancellation({ ...base, lifecycleStatus: 'CANCELLED' }, [
      { action: 'order.cancel', userName: 'Kasir A', details: 'Pesanan TRX-1 dibatalkan. Alasan: x • Disetujui Pemilik: Bu Sari (kode sekali pakai)' },
    ])
    expect(row).toMatchObject({ stage: 'unprocessed', requestedBy: 'Kasir A', approvedBy: 'Bu Sari', approval: 'owner_code' })
  })

  it('data lama: order.cancel tanpa persetujuan → kasir sendiri', () => {
    const row = describeCancellation({ ...base, lifecycleStatus: 'CANCELLED' }, [
      { action: 'order.cancel', userName: 'Kasir A', details: 'Pesanan TRX-1 dibatalkan. Alasan: x' },
    ])
    expect(row).toMatchObject({ requestedBy: 'Kasir A', approvedBy: 'Kasir A', approval: 'self' })
  })

  it('data lama: order.void → pelaku = penyetuju supervisor, peminta tak diketahui', () => {
    const row = describeCancellation({ ...base, lifecycleStatus: 'VOIDED' }, [
      { action: 'order.void', userName: 'Pak Sup', details: 'Pesanan TRX-1 dibatalkan. Alasan: x' },
    ])
    expect(row).toMatchObject({ stage: 'kitchen', requestedBy: null, approvedBy: 'Pak Sup', approval: 'supervisor' })
  })
})

describe('buildCancellationReport', () => {
  it('mengabaikan pesanan kosong Rp0, menjumlah, dan mengelompokkan', () => {
    const report = buildCancellationReport(
      30,
      [
        { ...base, id: 'a', voidedAt: 10, paidAt: 3, voidReason: 'Salah input', voidRequestedByName: 'Kasir A', voidedByName: 'Bu Sari', voidApproval: 'owner_code' },
        { ...base, id: 'b', voidedAt: 20, grandTotal: 5000, lifecycleStatus: 'CANCELLED', voidReason: 'Salah input', voidRequestedByName: 'Kasir A', voidedByName: 'Kasir A', voidApproval: 'self' },
        { ...base, id: 'c', voidedAt: 30, grandTotal: 0, voidReason: 'Pesanan kosong dibatalkan' },
      ],
      [],
    )
    expect(report.totals).toEqual({ count: 2, value: 25000, paidCount: 1, paidValue: 20000, ownerCodeCount: 1 })
    expect(report.rows.map((r) => r.orderId)).toEqual(['b', 'a'])
    expect(report.byRequester).toEqual([{ name: 'Kasir A', count: 2, value: 25000 }])
    expect(report.byReason[0]).toEqual({ name: 'Salah input', count: 2, value: 25000 })
  })
})
