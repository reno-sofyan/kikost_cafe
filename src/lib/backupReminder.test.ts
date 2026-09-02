import { beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_STALE_MS,
  backupIsStale,
  getLastBackupAt,
  lastBackupLabel,
  markBackupDone,
} from './backupReminder'

beforeEach(() => localStorage.clear())

describe('backupReminder', () => {
  it('belum pernah backup → stale, label "belum pernah"', () => {
    expect(getLastBackupAt()).toBeNull()
    expect(backupIsStale()).toBe(true)
    expect(lastBackupLabel()).toBe('belum pernah')
  })

  it('baru saja backup → tidak stale', () => {
    markBackupDone()
    expect(backupIsStale()).toBe(false)
    expect(getLastBackupAt()).toBeGreaterThan(0)
  })

  it('backup lewat ambang → stale lagi', () => {
    const old = Date.now() - BACKUP_STALE_MS - 60_000
    markBackupDone(old)
    expect(backupIsStale()).toBe(true)
    expect(lastBackupLabel()).toMatch(/hari lalu/)
  })

  it('label jam untuk backup beberapa jam lalu', () => {
    markBackupDone(Date.now() - 5 * 60 * 60 * 1000)
    expect(lastBackupLabel()).toBe('5 jam lalu')
  })
})
