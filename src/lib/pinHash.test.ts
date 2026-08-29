import { describe, expect, it } from 'vitest'
import { hashPin, isValidPinFormat, verifyPin } from './pinHash'

describe('isValidPinFormat', () => {
  it('menerima 4-8 digit', () => {
    expect(isValidPinFormat('1234')).toBe(true)
    expect(isValidPinFormat('12345678')).toBe(true)
  })
  it('menolak selain 4-8 digit', () => {
    expect(isValidPinFormat('123')).toBe(false)
    expect(isValidPinFormat('123456789')).toBe(false)
    expect(isValidPinFormat('12ab')).toBe(false)
    expect(isValidPinFormat('')).toBe(false)
  })
})

describe('hashPin / verifyPin', () => {
  it('menghasilkan salt unik dan hash yang bukan plaintext', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('1234')
    expect(a.salt).not.toEqual(b.salt)
    expect(a.hash).not.toEqual(b.hash)
    expect(a.hash).not.toContain('1234')
  })

  it('memverifikasi PIN benar', async () => {
    const { hash, salt } = await hashPin('869245')
    expect(await verifyPin('869245', salt, hash)).toBe(true)
  })

  it('menolak PIN salah', async () => {
    const { hash, salt } = await hashPin('869245')
    expect(await verifyPin('000000', salt, hash)).toBe(false)
  })
})
