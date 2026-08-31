import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, idbGet, openShift } from './helpers'

interface Product {
  id: string
  name: string
  sku: string
  stockQty: number
}
interface OrderRow {
  id: string
  status: string
  grandTotal: number
}
interface StockMovementRow {
  itemId: string
  reason: string
  qtyDelta: number
  refOrderId: string | null
}

test('transaksi takeaway tunai: bayar → sukses → stok berkurang tepat satu kali', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  // Stok awal "Kentang Goreng" (SNACK-002, tanpa modifier, trackOwnStock).
  const before = (await idbAll<Product>(page, 'products')).find((p) => p.sku === 'SNACK-002')!
  expect(before.stockQty).toBe(60)

  // Kasir → pesanan baru takeaway.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const newOrder = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pesanan Baru' }),
  })
  await newOrder.getByRole('button', { name: 'Takeaway' }).click()
  await newOrder.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await expect(newOrder).toBeHidden()

  // Tambah item tanpa modifier.
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()

  // Keranjang berisi item; tombol Bayar aktif dengan total > harga dasar (pajak+SC).
  await expect(page.getByText('Kentang Goreng').first()).toBeVisible()
  const payButton = page.getByRole('button', { name: /^Bayar •/ })
  await expect(payButton).toBeEnabled()
  await payButton.click()

  // Layar pembayaran.
  await expect(page.getByRole('heading', { name: /^Pembayaran •/ })).toBeVisible()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()

  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pembayaran Tunai' }),
  })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()

  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()

  // Sukses.
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  // Verifikasi DB: order paid, stok -1 sekali, satu stockMovement 'sale'.
  const orders = await idbAll<OrderRow>(page, 'orders')
  const paid = orders.filter((o) => o.status === 'paid')
  expect(paid).toHaveLength(1)

  const after = await idbGet<Product>(page, 'products', before.id)
  expect(after?.stockQty).toBe(59)

  const moves = (await idbAll<StockMovementRow>(page, 'stockMovements')).filter(
    (m) => m.itemId === before.id && m.reason === 'sale',
  )
  expect(moves).toHaveLength(1)
  expect(moves[0].qtyDelta).toBe(-1)
  expect(moves[0].refOrderId).toBe(paid[0].id)

  // "Transaksi Baru" kembali ke kasir siap pakai.
  await page.getByRole('button', { name: 'Transaksi Baru' }).click()
  await expect(page).toHaveURL(/\/kasir$/)
})

test('pembayaran tunai kurang dari total ditolak', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const newOrder = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pesanan Baru' }),
  })
  await newOrder.getByRole('button', { name: 'Takeaway' }).click()
  await newOrder.getByRole('button', { name: 'Mulai Pesanan' }).click()

  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()

  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pembayaran Tunai' }),
  })
  // Isi jumlah pembayaran jauh di bawah total.
  await cash.getByLabel('Jumlah untuk tagihan ini').fill('1000')
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()

  // Sisa tagihan masih > 0 → tombol selesai tetap nonaktif.
  await expect(page.getByRole('button', { name: 'Selesaikan Pembayaran' })).toBeDisabled()

  // Tidak ada order paid.
  const orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders.filter((o) => o.status === 'paid')).toHaveLength(0)
})
