import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetAuthThrottle,
  isAuthBlocked,
  pruneAuthThrottle,
  recordAuthFailure,
  recordAuthSuccess,
} from '../src/lib/authThrottle.js'

beforeEach(() => _resetAuthThrottle())

describe('authThrottle', () => {
  it('memblokir IP setelah 10 kegagalan berturut-turut', () => {
    const ip = '203.0.113.5'
    for (let i = 0; i < 9; i++) recordAuthFailure(ip)
    expect(isAuthBlocked(ip)).toBe(false)
    recordAuthFailure(ip)
    expect(isAuthBlocked(ip)).toBe(true)
  })

  it('sukses auth mereset hitungan kegagalan', () => {
    const ip = '203.0.113.6'
    for (let i = 0; i < 9; i++) recordAuthFailure(ip)
    recordAuthSuccess(ip)
    for (let i = 0; i < 9; i++) recordAuthFailure(ip)
    expect(isAuthBlocked(ip)).toBe(false)
  })

  it('IP berbeda tak saling memengaruhi', () => {
    for (let i = 0; i < 10; i++) recordAuthFailure('a')
    expect(isAuthBlocked('a')).toBe(true)
    expect(isAuthBlocked('b')).toBe(false)
  })

  it('prune tak melempar & tak menghapus IP yang masih diblokir', () => {
    for (let i = 0; i < 10; i++) recordAuthFailure('c')
    pruneAuthThrottle()
    expect(isAuthBlocked('c')).toBe(true)
  })
})
