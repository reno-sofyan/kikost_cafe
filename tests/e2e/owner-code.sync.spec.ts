import { expect, request, test, type Locator, type Page } from '@playwright/test'
import { completeOnboarding, configureBackend, idbAll, openShift, waitForNoPending, waitForOrderItems } from './helpers'
import { E2E_API_URL, E2E_KANTIN_DEVICE_KEY, E2E_KANTIN_TENANT, E2E_OPS_TOKEN } from '../../playwright.sync.config'

interface OrderRow {
  id: string
  orderNumber: string
  status: string
}

const dialogWith = (page: Page, heading: string | RegExp) =>
  page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: heading }) })

/** Konsol operator /ops untuk tenant kantin e2e. */
async function opsApi<T>(method: 'GET' | 'POST', path: string): Promise<T> {
  const ctx = await request.newContext()
  const res = await ctx.fetch(`${E2E_API_URL}/ops/api/tenant/${E2E_KANTIN_TENANT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${E2E_OPS_TOKEN}` },
  })
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as T
  await ctx.dispose()
  return body
}

async function startOrderWithItem(page: Page, buyer: string, itemCount: number) {
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const dialog = dialogWith(page, 'Pesanan Baru')
  await dialog.getByPlaceholder('mis. "Budi"').fill(buyer)
  await dialog.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Minuman', exact: true }).click()
  await page.getByRole('button', { name: /Air Mineral/ }).click()
  await waitForOrderItems(page, itemCount)
}

/** Batalkan Pesanan → alasan → kode Pemilik; mengembalikan dialog kode. */
async function submitCancelCode(page: Page, code: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Batalkan Pesanan', exact: true }).click()
  const reason = dialogWith(page, /^Batalkan Pesanan/)
  await reason.getByRole('button', { name: 'Pembeli tidak jadi' }).click()
  await reason.getByRole('button', { name: 'Lanjut ke Kode Pemilik' }).click()
  const owner = dialogWith(page, /^Batalkan /)
  await expect(owner.getByText(/dibuat di Konsol Pemilik online/)).toBeVisible()
  for (const digit of code) await owner.getByRole('button', { name: digit, exact: true }).click()
  await owner.getByRole('button', { name: 'Setujui Pembatalan' }).click()
  return owner
}

test('kantin: kode Pemilik dari konsol online membatalkan pesanan sekali, lalu tercatat di laporan pembatalan', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { businessType: 'Kantin' })
  await openShift(page)
  await configureBackend(page, E2E_API_URL, E2E_KANTIN_DEVICE_KEY)

  // Persetujuan dicatat atas nama akun Pemilik di tablet.
  await page.getByRole('button', { name: 'Pengguna', exact: true }).click()
  await page.getByRole('button', { name: '+ Pengguna Baru' }).click()
  const userForm = dialogWith(page, 'Pengguna Baru')
  await userForm.getByLabel('Nama').fill('Pemilik E2E')
  await userForm.getByLabel('Role').selectOption({ label: 'Pemilik' })
  await userForm.getByLabel('PIN (4-8 digit)').fill('135790')
  await userForm.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(userForm).toBeHidden()

  await startOrderWithItem(page, 'Rina', 1)
  const { code } = await opsApi<{ code: string }>('POST', '/owner-code')
  expect(code).toMatch(/^\d{6}$/)

  const owner = await submitCancelCode(page, code)
  await expect(owner).toBeHidden()
  await expect.poll(async () => (await idbAll<OrderRow>(page, 'orders'))[0]?.status).toBe('void')
  const [cancelled] = await idbAll<OrderRow>(page, 'orders')

  // Kode server sekali pakai: pesanan kedua tak bisa dibatalkan dengan kode yang sama.
  await startOrderWithItem(page, 'Dodi', 2)
  const reused = await submitCancelCode(page, code)
  await expect(reused.getByText(/Kode (pembatalan salah|sudah terpakai)/)).toBeVisible()
  await reused.getByRole('button', { name: 'Batal', exact: true }).click()
  const orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders.filter((o) => o.status === 'open')).toHaveLength(1)
  expect((await opsApi<{ active: unknown; lastUsed: unknown }>('GET', '/owner-code'))).toEqual(expect.objectContaining({ active: null, lastUsed: expect.anything() }))

  // Setelah sinkron, Konsol mencatat pembatalan itu disetujui kode Pemilik.
  await waitForNoPending(page)
  await expect
    .poll(async () => (await opsApi<{ totals: { count: number; ownerCodeCount: number } }>('GET', '/cancellations')).totals)
    .toEqual(expect.objectContaining({ count: 1, ownerCodeCount: 1 }))
  const report = await opsApi<{ rows: { orderNumber?: string }[] }>('GET', '/cancellations')
  expect(JSON.stringify(report)).toContain(cancelled!.orderNumber)
})
