import type { StaffPay } from '@/types/domain'

export interface PayrollInputRow {
  userId: string
  userName: string
  daysPresent: number
  totalMinutes: number
  missingOutCount: number
}

export interface PayrollRow extends PayrollInputRow {
  /** null = tarif belum diatur → gaji tak dihitung. */
  pay: StaffPay | null
  hours: number
  gross: number
}

export interface Payroll {
  rows: PayrollRow[]
  total: number
  /** Karyawan yang hadir tetapi belum punya tarif. */
  missingRateCount: number
}

/** Tarif milik karyawan: cocokkan id dulu, lalu nama (id pengguna berbeda antar perangkat). */
export function payFor(staffPay: Record<string, StaffPay> | null | undefined, userId: string, userName: string): StaffPay | null {
  if (!staffPay) return null
  const direct = staffPay[userId]
  if (direct && direct.rate > 0) return direct
  const wanted = userName.trim().toLowerCase()
  return Object.values(staffPay).find((p) => p.rate > 0 && p.name.trim().toLowerCase() === wanted) ?? null
}

/**
 * Gaji kotor dari rekap absensi. Per jam = jam kerja tercatat × tarif (sesi tanpa absen
 * pulang bernilai 0 jam, jadi tak dibayar sampai dikoreksi); per hari = hari hadir × tarif.
 */
export function buildPayroll(rows: PayrollInputRow[], staffPay: Record<string, StaffPay> | null | undefined): Payroll {
  const out: PayrollRow[] = rows.map((r) => {
    const pay = payFor(staffPay, r.userId, r.userName)
    const hours = r.totalMinutes / 60
    const gross = !pay ? 0 : Math.round(pay.type === 'hourly' ? hours * pay.rate : r.daysPresent * pay.rate)
    return { ...r, pay, hours, gross }
  })
  return { rows: out, total: out.reduce((s, r) => s + r.gross, 0), missingRateCount: out.filter((r) => !r.pay).length }
}

export function payrollToCsv(payroll: Payroll, periodLabel: string): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [[`Rekap Gaji ${periodLabel}`].map(cell).join(','), ['Karyawan', 'Jenis Tarif', 'Tarif', 'Hari Hadir', 'Jam Kerja', 'Gaji Kotor', 'Keterangan'].map(cell).join(',')]
  for (const r of payroll.rows) {
    lines.push(
      [
        r.userName,
        r.pay ? (r.pay.type === 'hourly' ? 'Per jam' : 'Per hari') : '',
        r.pay?.rate ?? '',
        r.daysPresent,
        r.hours.toFixed(2),
        r.gross,
        [!r.pay ? 'Tarif belum diatur' : '', r.missingOutCount > 0 ? `${r.missingOutCount}x tanpa absen pulang` : ''].filter(Boolean).join('; '),
      ]
        .map(cell)
        .join(','),
    )
  }
  lines.push(['Total', '', '', '', '', payroll.total, ''].map(cell).join(','))
  return lines.join('\n')
}
