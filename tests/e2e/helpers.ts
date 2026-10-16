import { expect, type Page } from '@playwright/test'

/** Selesaikan onboarding (context IndexedDB harus kosong) → login admin otomatis. */
export async function completeOnboarding(
  page: Page,
  opts: { businessName?: string; taxPercent?: string; servicePercent?: string; pin?: string; businessType?: 'Kafe & Restoran' | 'Kantin' | 'Minimarket & Ritel' } = {},
): Promise<void> {
  const { businessName = 'Usaha E2E', taxPercent = '11', servicePercent = '5', pin = '246810', businessType } = opts
  await page.goto('/')
  await page.getByRole('button', { name: 'Lanjut' }).click() // welcome
  if (businessType) await page.getByRole('button', { name: new RegExp(`^${businessType}`) }).click()
  await page.getByLabel('Nama Usaha', { exact: true }).fill(businessName)
  await page.getByRole('button', { name: 'Lanjut' }).click() // profile
  await page.getByLabel('Pajak (%)').fill(taxPercent)
  // Kantin & minimarket tak memakai service charge — isiannya disembunyikan.
  const service = page.getByLabel('Service Charge (%)')
  if (await service.isVisible()) await service.fill(servicePercent)
  await page.getByRole('button', { name: 'Lanjut' }).click() // fiscal
  await page.getByRole('button', { name: 'Lanjut' }).click() // qris
  await page.getByRole('button', { name: 'Lanjut' }).click() // printer
  await page.getByLabel('Nama Administrator').fill('Admin E2E')
  await page.getByLabel('PIN (4-8 digit)').fill(pin)
  await page.getByLabel('Konfirmasi PIN').fill(pin)
  await page.getByRole('button', { name: /Selesai/ }).click()
  await expect(page.getByRole('heading', { name: 'Belum Ada Shift Aktif' })).toBeVisible({ timeout: 15_000 })
}

/** Buka shift dengan modal awal tertentu (dari layar mana pun; menavigasi ke /shift). */
export async function openShift(page: Page, openingCash = '500000'): Promise<void> {
  await page.getByRole('link', { name: 'Shift' }).click()
  await page.getByRole('button', { name: 'Buka Shift' }).click()
  const dialog = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Buka Shift' }),
  })
  await dialog.getByLabel('Modal Awal').fill(openingCash)
  await dialog.getByRole('button', { name: 'Buka Shift' }).click()
  await expect(dialog).toBeHidden()
}

/** Baca satu record dari IndexedDB aplikasi (store berdasarkan keyPath 'id'). */
export async function idbGet<T = unknown>(page: Page, store: string, id: string): Promise<T | undefined> {
  return page.evaluate(
    ({ store, id }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('kione-pos')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(store, 'readonly')
          const getReq = tx.objectStore(store).get(id)
          getReq.onsuccess = () => resolve(getReq.result)
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    { store, id },
  ) as Promise<T | undefined>
}

/** Semua record dari sebuah store. */
export async function idbAll<T = unknown>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    ({ store }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('kione-pos')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(store, 'readonly')
          const getReq = tx.objectStore(store).getAll()
          getReq.onsuccess = () => resolve(getReq.result)
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    { store },
  ) as Promise<T[]>
}

/**
 * Tunggu sampai `count` item pesanan tersimpan di IndexedDB. Klik produk di Kasir
 * menyimpan item secara async — membaca total pesanan langsung sesudah klik bisa
 * mendapat nilai SEBELUM item terakhir masuk. Total pesanan dihitung ulang dalam
 * transaksi yang sama dengan penyimpanan item, jadi setelah ini total sudah final.
 */
export async function waitForOrderItems(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await idbAll<{ removed?: boolean }>(page, 'orderItems')).filter((i) => !i.removed).length)
    .toBe(count)
}

/** Hubungkan tablet ke backend di Pengaturan → Sinkronisasi (dipakai spec *.sync.spec.ts). */
export async function configureBackend(page: Page, apiUrl: string, deviceKey: string): Promise<void> {
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Sinkronisasi' }).click()
  await page.getByLabel('URL Backend').fill(apiUrl)
  await page.getByLabel('Kunci Perangkat').fill(deviceKey)
  await page.getByRole('button', { name: 'Uji Koneksi' }).click()
  await expect(page.getByText('Koneksi backend berhasil.')).toBeVisible()
  await page.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByText('Konfigurasi disimpan.')).toBeVisible()
}

/** Sinkronkan sekarang lalu tunggu antrean kosong tanpa kegagalan. */
export async function waitForNoPending(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Sinkronisasi' }).click()
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await expect(page.getByText('Menunggu sinkronisasi: 0')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Gagal sinkronisasi: 0')).toBeVisible()
}
