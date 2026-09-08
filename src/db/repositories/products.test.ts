import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import {
  createProduct,
  deleteProductIfUnused,
  listArchivedProducts,
  listAvailableProducts,
  listProducts,
  searchProducts,
  setProductArchived,
} from './products'
import type { OrderItem } from '@/types/domain'

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

const base = {
  categoryId: 'c1', sku: 'X', barcode: null, price: 1000, costPrice: 100, unit: 'pcs' as const,
  photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
  isFavorite: false, isAvailable: true, modifierGroupIds: [],
}

describe('Arsip & hapus produk', () => {
  it('arsipkan: hilang dari daftar aktif / tersedia / cari, muncul di arsip; pulihkan mengembalikan', async () => {
    const p = await createProduct({ ...base, name: 'Kopi Lama', sku: 'K1' })

    await setProductArchived(p.id, true)
    expect((await listProducts()).map((x) => x.id)).not.toContain(p.id)
    expect((await listAvailableProducts()).map((x) => x.id)).not.toContain(p.id)
    expect((await searchProducts('Kopi')).map((x) => x.id)).not.toContain(p.id)
    expect((await listArchivedProducts()).map((x) => x.id)).toEqual([p.id])
    expect((await db.products.get(p.id))?.isAvailable).toBe(false)

    await setProductArchived(p.id, false)
    expect((await listProducts()).map((x) => x.id)).toContain(p.id)
    expect((await listArchivedProducts())).toHaveLength(0)
  })

  it('hapus permanen: boleh bila belum pernah terjual', async () => {
    const p = await createProduct({ ...base, name: 'Uji', sku: 'U1' })
    await deleteProductIfUnused(p.id)
    expect(await db.products.get(p.id)).toBeUndefined()
  })

  it('hapus permanen: ditolak bila sudah pernah masuk pesanan', async () => {
    const p = await createProduct({ ...base, name: 'Terjual', sku: 'T1' })
    await db.orderItems.put({
      id: 'oi1', orderId: 'o1', productId: p.id, productName: 'Terjual', unitPrice: 1000, qty: 1,
      modifiers: [], discountAmount: 0, lineTotal: 1000, notes: '', voided: false, removed: false,
      createdAt: 1, updatedAt: 1,
    } as unknown as OrderItem)

    await expect(deleteProductIfUnused(p.id)).rejects.toThrow(/pernah terjual/)
    expect(await db.products.get(p.id)).toBeDefined()
  })
})
