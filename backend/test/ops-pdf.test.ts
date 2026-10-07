import { describe, expect, it } from 'vitest'
import { buildCancellationsPdf, buildTransactionsPdf, pdfText } from '../src/lib/opsPdf.js'
import { buildCancellationReport } from '../src/lib/opsCancellations.js'
import { parseWibRange } from '../src/routes/ops.js'

const meta = { businessName: 'Kantin Sehat', tenantId: 'kantin', periodLabel: '07 Okt 2026', generatedAt: Date.UTC(2026, 9, 7, 5) }

describe('parseWibRange', () => {
  const now = Date.UTC(2026, 9, 6, 20) // 7 Okt 03:00 WIB
  it('default = hari ini (WIB)', () => {
    const r = parseWibRange(undefined, undefined, now)
    expect(r).toMatchObject({ sinceMs: Date.UTC(2026, 9, 6, 17), untilMs: Date.UTC(2026, 9, 7, 17), fileLabel: '2026-10-07' })
  })
  it('rentang inklusif & label', () => {
    const r = parseWibRange('2026-10-01', '2026-10-07', now)
    expect(r).toMatchObject({ sinceMs: Date.UTC(2026, 8, 30, 17), untilMs: Date.UTC(2026, 9, 7, 17), fileLabel: '2026-10-01_2026-10-07' })
  })
  it('menolak format salah, terbalik, dan > 92 hari', () => {
    expect(parseWibRange('07-10-2026', undefined, now)).toHaveProperty('error')
    expect(parseWibRange('2026-13-40', undefined, now)).toHaveProperty('error')
    expect(parseWibRange('2026-02-30', undefined, now)).toHaveProperty('error')
    expect(parseWibRange('2026-10-07', '2026-10-01', now)).toHaveProperty('error')
    expect(parseWibRange('2026-01-01', '2026-10-07', now)).toHaveProperty('error')
  })
})

describe('PDF ops', () => {
  it('pdfText mengganti karakter di luar WinAnsi', () => {
    expect(pdfText('a → b — c • d × 2 ✓')).toBe('a -> b - c - d x 2 ?')
  })

  it('transaksi: PDF valid, multi-halaman untuk data banyak', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      orderNumber: `TRX-${i}`, queueNumber: i, buyer: 'Pembeli dengan nama yang cukup panjang sekali', cashierName: 'Rina',
      methods: ['cash'], status: 'paid' as const, payLater: false, grandTotal: 10000, at: meta.generatedAt,
      discountAmount: i % 10 === 0 ? 1000 : 0, discountReason: i % 10 === 0 ? 'Karyawan' : null, discountByName: 'Rina', discountApproval: (i % 10 === 0 ? 'self' : null) as 'self' | null,
    }))
    const pdf = buildTransactionsPdf(meta, {
      rows, byMethod: [{ method: 'cash', amount: 1_200_000, count: 120 }], paidCount: 120, paidValue: 1_200_000,
      voidCount: 0, openPayLaterCount: 0, openPayLaterValue: 0, discountCount: 12, discountValue: 12000,
    })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(3000)
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1)
  })

  it('pembatalan: PDF valid termasuk catatan item yang dihapus', () => {
    const report = buildCancellationReport(
      30,
      [{ id: 'c', orderNumber: 'TRX-10', status: 'void', grandTotal: 0, lifecycleStatus: 'CANCELLED', voidedAt: meta.generatedAt, voidReason: 'Pesanan kosong dibatalkan' }],
      [],
      [{ orderId: 'c', productName: 'Ayam Geprek', qty: 2, lineTotal: 36000, removed: true }],
    )
    const pdf = buildCancellationsPdf(meta, report)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('periode kosong tetap menghasilkan PDF', () => {
    const empty = buildCancellationReport(1, [], [])
    expect(buildCancellationsPdf(meta, empty).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
