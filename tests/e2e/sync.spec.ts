import { expect, request, test, type Page } from '@playwright/test'
import { completeOnboarding, configureBackend, openShift, waitForNoPending } from './helpers'
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

/** Tunggu sampai server berisi `n` pesanan lunas. "Menunggu sinkronisasi: 0" bisa tampil
 *  sesaat sebelum push yang sedang berjalan selesai, jadi server dibaca berulang. */
async function waitServerPaid(n: number) {
  await expect.poll(async () => (await serverOrders()).filter((o) => o.status === 'paid').length, { timeout: 15_000 }).toBe(n)
  return (await serverOrders()).filter((o) => o.status === 'paid')
}

async function payTakeaway(page: Page) {
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
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

test('transaksi tersinkron ke server tepat satu kali (online & setelah offline)', async ({ page, context }) => {
  await completeOnboarding(page)
  await openShift(page)
  await configureBackend(page, E2E_API_URL, E2E_DEVICE_KEY)

  // 1. Transaksi ONLINE → tersinkron.
  await payTakeaway(page)
  await waitForNoPending(page)

  await waitServerPaid(1)

  // 2. Transaksi OFFLINE → antre → sinkron setelah online, tanpa duplikat.
  await context.setOffline(true)
  await payTakeaway(page)
  // Masih 1 di server saat offline.
  await context.setOffline(false)
  await waitForNoPending(page)

  const paid = await waitServerPaid(2)
  // Tidak ada nomor transaksi ganda.
  expect(new Set(paid.map((o) => o.orderNumber)).size).toBe(2)

  // 3. Sinkron ulang berkali-kali tidak menambah / mengubah apa pun (idempoten).
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await expect(page.getByText('Gagal sinkronisasi: 0')).toBeVisible()
  const after = await serverOrders()
  expect(after.filter((o) => o.status === 'paid')).toHaveLength(2)
})
