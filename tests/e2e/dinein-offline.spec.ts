import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, idbGet, openShift } from './helpers'

interface Product { id: string; sku: string; stockQty: number }
interface OrderRow { id: string; status: string; type: string; tableId: string | null; queueNumber: number | null; notes: string }

test('dine-in tanpa meja: pesan → BAYAR OFFLINE → sukses, stok & antrean konsisten', async ({ page, context }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  // Dine-in adalah default; tambahkan catatan pelanggan lalu mulai.
  await page.getByPlaceholder('mis. "Budi" atau "cewe jaket merah"').fill('Budi')
  await page.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await expect(page).toHaveURL(/\/kasir$/)
  await expect(page.getByText(/Antrean #\d+/).first()).toBeVisible()

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
  expect(paid[0].tableId).toBeNull()
  expect(paid[0].queueNumber).toBeGreaterThan(0)
  expect(paid[0].notes).toBe('Budi')

  const after = await idbGet<Product>(page, 'products', before.id)
  expect(after?.stockQty).toBe(before.stockQty - 1)

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
