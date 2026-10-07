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
  it('menghitung semua pembatalan, termasuk yang dikosongkan dulu (nilai = item yang dihapus)', () => {
    const report = buildCancellationReport(
      30,
      [
        { ...base, id: 'a', voidedAt: 10, paidAt: 3, voidReason: 'Salah input', voidRequestedByName: 'Kasir A', voidedByName: 'Bu Sari', voidApproval: 'owner_code' },
        { ...base, id: 'b', voidedAt: 20, grandTotal: 5000, lifecycleStatus: 'CANCELLED', voidReason: 'Salah input', voidRequestedByName: 'Kasir A', voidedByName: 'Kasir A', voidApproval: 'self' },
        { ...base, id: 'c', voidedAt: 30, grandTotal: 0, lifecycleStatus: 'CANCELLED', voidReason: 'Pesanan kosong dibatalkan' },
        { ...base, id: 'd', voidedAt: 40, grandTotal: 0, lifecycleStatus: 'CANCELLED', voidReason: 'Pesanan kosong dibatalkan' },
      ],
      [{ action: 'order.cancelEmpty', entityId: 'c', userName: 'Kasir B', details: 'Pesanan kosong dibatalkan' }],
      [
        { orderId: 'c', productName: 'Nasi Goreng', qty: 2, lineTotal: 30000, removed: true, updatedAt: 25 },
        { orderId: 'c', productName: 'Es Teh', qty: 1, lineTotal: 5000, removed: true, removedReason: 'Salah tap', removedByName: 'Kasir B', removedAt: 26 },
        { orderId: 'a', productName: 'Mie', qty: 1, lineTotal: 20000, removed: false, reducedValue: 4000 },
      ],
    )
    expect(report.totals).toMatchObject({
      count: 4,
      value: 60000,
      paidCount: 1,
      paidValue: 20000,
      ownerCodeCount: 1,
      emptiedFirstCount: 1,
      emptiedFirstValue: 35000,
      neverHadItemsCount: 1,
    })
    const c = report.rows.find((r) => r.orderId === 'c')!
    expect(c).toMatchObject({ emptiedFirst: true, neverHadItems: false, value: 35000, requestedBy: 'Kasir B', approval: 'self' })
    expect(c.corrections.map((x) => [x.name, x.kind, x.reason])).toEqual([
      ['Nasi Goreng', 'removed', null],
      ['Es Teh', 'removed', 'Salah tap'],
    ])
    expect(report.rows.find((r) => r.orderId === 'd')).toMatchObject({ emptiedFirst: false, neverHadItems: true, value: 0 })
    expect(report.rows.find((r) => r.orderId === 'a')!.corrections).toEqual([
      expect.objectContaining({ kind: 'reduced', value: 4000 }),
    ])
  })
})
