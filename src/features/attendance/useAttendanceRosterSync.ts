import { useEffect, useMemo } from 'react'
import { isBackendConfigured, uploadAttendanceRoster } from '@/sync/client'
import type { User } from '@/types/domain'

/**
 * Mengirim daftar karyawan aktif (nama + hash PIN) ke server tiap kali berubah, supaya
 * karyawan bisa memilih namanya & memasukkan PIN di HP. Diam saja bila tablet belum
 * tersambung atau sedang offline — dicoba lagi saat layar Absensi dibuka berikutnya.
 */
export function useAttendanceRosterSync(users: User[]) {
  const payload = useMemo(
    () => JSON.stringify(users.filter((u) => u.active && u.pinHash && u.pinSalt).map((u) => ({ userId: u.id, userName: u.name, pinHash: u.pinHash, pinSalt: u.pinSalt }))),
    [users],
  )
  useEffect(() => {
    if (!isBackendConfigured()) return
    uploadAttendanceRoster(JSON.parse(payload) as Parameters<typeof uploadAttendanceRoster>[0]).catch(() => undefined)
  }, [payload])
}
