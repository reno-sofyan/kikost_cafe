import { expect, request, test, type Page } from '@playwright/test'
import { completeOnboarding, openShift } from './helpers'
import { E2E_API_URL, E2E_DEVICE_KEY } from '../../playwright.sync.config'

/** Ambil semua entitas `orders` dari server (source of truth kanonik). */
async function serverOrders(): Promise<{ id: string; status: string; orderNumber: string }[]> {
  const ctx = await request.newContext()
  const res = await ctx.get(`${E2E_API_URL}/api/sync/pull?since=0`, {
    headers: { Authorization: `Bearer ${E2E_DEVICE_KEY}` },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  await ctx.dispose()
  return (body.entities.orders ?? []) as { id: string; status: string; orderNumber: string }[]
}

async function configureBackend(page: Page) {
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Sinkronisasi' }).click()
  await page.getByLabel('URL Backend').fill(E2E_API_URL)
  await page.getByLabel('Kunci Perangkat').fill(E2E_DEVICE_KEY)
  await page.getByRole('button', { name: 'Uji Koneksi' }).click()
  await expect(page.getByText('Koneksi backend berhasil.')).toBeVisible()
  await page.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByText('Konfigurasi disimpan.')).toBeVisible()
}

async function payTakeaway(page: Page) {
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pembayaran Tunai' }),
  })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
}

async function waitForNoPending(page: Page) {
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Sinkronisasi' }).click()
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await expect(page.getByText('Menunggu sinkronisasi: 0')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Gagal sinkronisasi: 0')).toBeVisible()
}

test('transaksi tersinkron ke server tepat satu kali (online & setelah offline)', async ({ page, context }) => {
  await completeOnboarding(page)
  await openShift(page)
  await configureBackend(page)

  // 1. Transaksi ONLINE → tersinkron.
  await payTakeaway(page)
  await waitForNoPending(page)

  let orders = await serverOrders()
  expect(orders.filter((o) => o.status === 'paid')).toHaveLength(1)

  // 2. Transaksi OFFLINE → antre → sinkron setelah online, tanpa duplikat.
  await context.setOffline(true)
  await payTakeaway(page)
  // Masih 1 di server saat offline.
  await context.setOffline(false)
  await waitForNoPending(page)

  orders = await serverOrders()
  const paid = orders.filter((o) => o.status === 'paid')
  expect(paid).toHaveLength(2)
  // Tidak ada nomor transaksi ganda.
  expect(new Set(paid.map((o) => o.orderNumber)).size).toBe(2)

  // 3. Sinkron ulang berkali-kali tidak menambah / mengubah apa pun (idempoten).
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await expect(page.getByText('Gagal sinkronisasi: 0')).toBeVisible()
  const after = await serverOrders()
  expect(after.filter((o) => o.status === 'paid')).toHaveLength(2)
})
