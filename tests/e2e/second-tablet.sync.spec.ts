import { expect, request, test } from '@playwright/test'
import { completeOnboarding, configureBackend, idbAll, waitForNoPending } from './helpers'
import { E2E_API_URL, E2E_MULTI_DEVICE_KEY } from '../../playwright.sync.config'

interface Row {
  id: string
  name: string
}

async function serverCatalog(): Promise<{ categories: Row[]; products: Row[] }> {
  const ctx = await request.newContext()
  const res = await ctx.get(`${E2E_API_URL}/api/sync/pull?since=0`, { headers: { Authorization: `Bearer ${E2E_MULTI_DEVICE_KEY}` } })
  expect(res.ok()).toBeTruthy()
  const { entities } = await res.json()
  await ctx.dispose()
  return { categories: entities.categories ?? [], products: entities.products ?? [] }
}

test('tablet kedua dengan katalog contoh memakai katalog server, tanpa kategori ganda', async ({ browser }) => {
  test.slow()
  // Tablet pertama: katalog contoh menjadi katalog usaha di server.
  const first = await browser.newContext()
  const tablet1 = await first.newPage()
  await completeOnboarding(tablet1, { businessType: 'Kantin' })
  await configureBackend(tablet1, E2E_API_URL, E2E_MULTI_DEVICE_KEY)
  await waitForNoPending(tablet1)
  // "Menunggu sinkronisasi: 0" bisa tampil sesaat sebelum push berjalan selesai — tunggu server terisi.
  await expect
    .poll(async () => {
      const c = await serverCatalog()
      return c.categories.length > 0 && c.products.length > 0
    }, { timeout: 15_000 })
    .toBe(true)
  const before = await serverCatalog()

  // Tablet kedua: onboarding juga dengan katalog contoh (bawaan), lalu dihubungkan.
  const second = await browser.newContext()
  const tablet2 = await second.newPage()
  await completeOnboarding(tablet2, { businessType: 'Kantin' })
  await configureBackend(tablet2, E2E_API_URL, E2E_MULTI_DEVICE_KEY)
  await expect(tablet2.getByText('Katalog contoh di tablet ini diganti katalog dari server.')).toBeVisible()
  await waitForNoPending(tablet2)

  // Server tak bertambah; tablet kedua memakai katalog yang sama persis.
  const after = await serverCatalog()
  expect(after.categories.map((c) => c.id).sort()).toEqual(before.categories.map((c) => c.id).sort())
  expect(after.products.map((p) => p.id).sort()).toEqual(before.products.map((p) => p.id).sort())
  const local = await idbAll<Row>(tablet2, 'categories')
  expect(local.map((c) => c.id).sort()).toEqual(before.categories.map((c) => c.id).sort())
  expect(local.filter((c) => c.name === 'Minuman')).toHaveLength(1)

  await first.close()
  await second.close()
})
