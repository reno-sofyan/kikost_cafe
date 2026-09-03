import { describe, expect, it } from 'vitest'
import { isSyncEntity, normalizePayload, shouldApply } from '../src/lib/entities.js'

describe('isSyncEntity', () => {
  it('menerima entitas yang dikenal', () => {
    expect(isSyncEntity('orders')).toBe(true)
    expect(isSyncEntity('stockMovements')).toBe(true)
  })
  it('menolak entitas asing', () => {
    expect(isSyncEntity('users')).toBe(false)
    expect(isSyncEntity('__proto__')).toBe(false)
    expect(isSyncEntity(42)).toBe(false)
  })
})

describe('normalizePayload', () => {
  it('menolak payload tanpa id', () => {
    const res = normalizePayload('a1', { foo: 1 })
    expect('error' in res).toBe(true)
  })
  it('menolak id yang tidak cocok', () => {
    const res = normalizePayload('a1', { id: 'b2', updatedAt: 1 })
    expect('error' in res).toBe(true)
  })
  it('mengambil updatedAt sebagai penanda LWW', () => {
    const res = normalizePayload('a1', { id: 'a1', updatedAt: 123, createdAt: 100 })
    expect('error' in res).toBe(false)
    if (!('error' in res)) expect(res.entityUpdatedAt).toBe(123)
  })
  it('jatuh ke createdAt bila updatedAt tidak ada', () => {
    const res = normalizePayload('a1', { id: 'a1', createdAt: 100 })
    if (!('error' in res)) expect(res.entityUpdatedAt).toBe(100)
  })
})

describe('shouldApply — last-write-wins', () => {
  it('menerapkan bila belum ada state', () => {
    expect(
      shouldApply({
        entity: 'customers',
        currentPayload: null,
        currentUpdatedAt: null,
        incomingPayload: { id: 'x', updatedAt: 5 },
        incomingUpdatedAt: 5,
      }).apply,
    ).toBe(true)
  })

  it('menolak payload yang lebih lama', () => {
    const d = shouldApply({
      entity: 'customers',
      currentPayload: { id: 'x' },
      currentUpdatedAt: 10,
      incomingPayload: { id: 'x' },
      incomingUpdatedAt: 5,
    })
    expect(d.apply).toBe(false)
  })

  it('menerima payload yang lebih baru', () => {
    const d = shouldApply({
      entity: 'customers',
      currentPayload: { id: 'x' },
      currentUpdatedAt: 10,
      incomingPayload: { id: 'x' },
      incomingUpdatedAt: 20,
    })
    expect(d.apply).toBe(true)
  })
})

describe('shouldApply — proteksi pesanan final', () => {
  it('tidak pernah mengembalikan pesanan paid ke open, meski lebih baru', () => {
    const d = shouldApply({
      entity: 'orders',
      currentPayload: { id: 'o1', status: 'paid' },
      currentUpdatedAt: 100,
      incomingPayload: { id: 'o1', status: 'open' },
      incomingUpdatedAt: 999,
    })
    expect(d.apply).toBe(false)
  })

  it('mengizinkan paid -> void bila lebih baru (void/retur sah)', () => {
    const d = shouldApply({
      entity: 'orders',
      currentPayload: { id: 'o1', status: 'paid' },
      currentUpdatedAt: 100,
      incomingPayload: { id: 'o1', status: 'void' },
      incomingUpdatedAt: 200,
    })
    expect(d.apply).toBe(true)
  })

  it('menolak perubahan pada pesanan final dengan timestamp lebih lama', () => {
    const d = shouldApply({
      entity: 'orders',
      currentPayload: { id: 'o1', status: 'void' },
      currentUpdatedAt: 300,
      incomingPayload: { id: 'o1', status: 'paid' },
      incomingUpdatedAt: 200,
    })
    expect(d.apply).toBe(false)
  })
})

describe('shouldApply — audit log & payment immutable', () => {
  it('audit log append-only: state yang sudah ada tak boleh ditimpa', () => {
    const d = shouldApply({
      entity: 'auditLogs',
      currentPayload: { id: 'a1', details: 'asli' },
      currentUpdatedAt: 100,
      incomingPayload: { id: 'a1', details: 'diubah' },
      incomingUpdatedAt: 999,
    })
    expect(d.apply).toBe(false)
  })

  it('audit log baru (belum ada state) tetap diterima', () => {
    const d = shouldApply({
      entity: 'auditLogs',
      currentPayload: null,
      currentUpdatedAt: null,
      incomingPayload: { id: 'a2' },
      incomingUpdatedAt: 100,
    })
    expect(d.apply).toBe(true)
  })

  it('pembayaran immutable: nominal tak boleh berubah lewat sync', () => {
    const d = shouldApply({
      entity: 'payments',
      currentPayload: { id: 'p1', amount: 20000 },
      currentUpdatedAt: 100,
      incomingPayload: { id: 'p1', amount: 999999 },
      incomingUpdatedAt: 999,
    })
    expect(d.apply).toBe(false)
  })
})
