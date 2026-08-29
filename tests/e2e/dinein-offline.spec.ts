import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, idbGet, openShift } from './helpers'

interface Product { id: string; sku: string; stockQty: number }
interface OrderRow { id: string; status: string; type: string; tableId: string | null }
interface TableRow { id: string; name: string; status: string; currentOrderId: string | null }

test('dine-in: pilih meja → pesan → BAYAR OFFLINE → sukses, stok & meja konsisten', async ({ page, context }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  // Layar Meja harus render (regresi bug SchemaError cafeTables.orderBy('name')).
  await page.getByRole('link', { name: 'Meja' }).click()
  await expect(page.getByRole('heading', { name: 'Denah Meja' })).toBeVisible()
  await expect(page.getByText('Indoor')).toBeVisible()
  await expect(page.getByText('Outdoor')).toBeVisible()

  // Klik meja tersedia → quickStart membuat order dine_in & pindah ke kasir.
  await page.getByRole('button', { name: /Meja 1/ }).click()
  await expect(page).toHaveURL(/\/kasir$/)

  // Tambah item.
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await expect(page.getByText('Kentang Goreng').first()).toBeVisible()

  const before = (await idbAll<Product>(page, 'products')).find((p) => p.sku === 'SNACK-002')!

  // ---- PUTUS INTERNET ----
  await context.setOffline(true)

  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pembayaran Tunai' }),
  })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()

  // Berhasil walau offline (data tersimpan lokal).
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  // Verifikasi IndexedDB.
  const orders = await idbAll<OrderRow>(page, 'orders')
  const paid = orders.filter((o) => o.status === 'paid')
  expect(paid).toHaveLength(1)
  expect(paid[0].type).toBe('dine_in')
  expect(paid[0].tableId).toBeTruthy()

  const after = await idbGet<Product>(page, 'products', before.id)
  expect(after?.stockQty).toBe(before.stockQty - 1)

  // Meja jadi "perlu dibersihkan" setelah bayar.
  const tableRow = (await idbAll<TableRow>(page, 'cafeTables')).find((t) => t.id === paid[0].tableId)!
  expect(tableRow.status).toBe('needs_cleaning')

  // Ada entri antrean sinkronisasi yang menunggu (belum terkirim karena offline).
  const queue = await idbAll<{ status: string; entity: string }>(page, 'syncQueue')
  expect(queue.some((q) => q.entity === 'orders' && q.status === 'pending')).toBe(true)

  // ---- SAMBUNG LAGI ----
  await context.setOffline(false)
  // Tanpa backend dikonfigurasi, engine tidak mengirim; data tetap utuh & tidak dobel.
  await page.reload()
  const ordersAfterReload = await idbAll<OrderRow>(page, 'orders')
  expect(ordersAfterReload.filter((o) => o.status === 'paid')).toHaveLength(1)
})
