import { expect, type Page } from '@playwright/test'

/** Selesaikan onboarding (context IndexedDB harus kosong) → login admin otomatis. */
export async function completeOnboarding(
  page: Page,
  opts: { cafeName?: string; taxPercent?: string; servicePercent?: string; pin?: string } = {},
): Promise<void> {
  const { cafeName = 'Kafe E2E', taxPercent = '11', servicePercent = '5', pin = '246810' } = opts
  await page.goto('/')
  await page.getByRole('button', { name: 'Lanjut' }).click() // welcome
  await page.getByLabel('Nama Kafe').fill(cafeName)
  await page.getByRole('button', { name: 'Lanjut' }).click() // profile
  await page.getByLabel('Pajak (%)').fill(taxPercent)
  await page.getByLabel('Service Charge (%)').fill(servicePercent)
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
        const req = indexedDB.open('kikost-cafe-pos')
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
        const req = indexedDB.open('kikost-cafe-pos')
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
