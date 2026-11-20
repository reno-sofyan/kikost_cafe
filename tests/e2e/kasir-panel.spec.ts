import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift, waitForOrderItems } from './helpers'

const dialogWith = (page: Page, heading: string | RegExp) =>
  page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: heading }) })

interface ItemRow {
  productName: string
  qty: number
  notes: string
  removed?: boolean
}

// Tablet kasir Kinara (Galaxy Tab landscape).
test.use({ viewport: { width: 1280, height: 800 } })

test('panel pesanan ringkas: repeat order terpisah, Perbesar, sheet item, menu Lainnya, Tutup → buka lagi, bayar', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)
  await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  await page.getByLabel('Catatan / nama pelanggan').fill('Meja Teras')
  await page.getByRole('button', { name: 'Mulai Pesanan' }).click()

  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).first().click()
  await page.getByRole('button', { name: /Pisang Goreng Keju/ }).first().click()
  await waitForOrderItems(page, 2)
  await expect(page.getByText('2 item · 2 pcs')).toBeVisible()
  // Belum ada yang dikirim → daftar polos tanpa judul grup.
  await expect(page.getByText(/Sudah dikirim/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Kirim ke Dapur/Bar' }).click()
  await expect(page.getByText(/2 item dikirim/)).toBeVisible()

  // Repeat order: tambahan baru tampil di grup terpisah di bawah item yang sudah dikirim.
  await page.getByRole('button', { name: /Roti Bakar Coklat Keju/ }).first().click()
  await waitForOrderItems(page, 3)
  await expect(page.getByRole('button', { name: /Sudah dikirim \(2\)/ })).toBeVisible()
  await expect(page.getByText('Tambahan baru (1)')).toBeVisible()
  await page.getByRole('button', { name: /Sudah dikirim \(2\)/ }).click() // lipat
  await expect(page.getByRole('button', { name: 'Detail Kentang Goreng' })).toHaveCount(0)
  await page.getByRole('button', { name: /Sudah dikirim \(2\)/ }).click() // buka lagi

  // Sheet item: catatan lewat tap nama item (tak ada lagi tautan "Tambah catatan" di baris).
  await page.getByRole('button', { name: 'Detail Roti Bakar Coklat Keju' }).click()
  await page.getByRole('button', { name: 'Tambah catatan Roti Bakar Coklat Keju' }).click()
  const note = dialogWith(page, 'Catatan Item')
  await note.getByLabel('Catatan item').fill('potong dua')
  await note.getByRole('button', { name: 'Simpan Catatan' }).click()
  await expect(page.getByText('"potong dua"')).toBeVisible()

  // Perbesar: qty tetap bisa diubah, ditutup tanpa kehilangan state.
  await page.getByRole('button', { name: 'Perbesar pesanan' }).click()
  const big = page.locator('[data-modal]').filter({ has: page.getByRole('button', { name: 'Tutup tampilan besar' }) })
  await big.getByRole('button', { name: 'Tambah jumlah Roti Bakar Coklat Keju' }).click()
  await expect(big.getByText('3 item · 4 pcs')).toBeVisible()
  await expect(big.getByRole('button', { name: 'Kirim ke Dapur/Bar' })).toBeVisible()
  await big.getByRole('button', { name: 'Tutup tampilan besar' }).click()
  await expect(big).toBeHidden()
  await expect(page.getByText('3 item · 4 pcs')).toBeVisible()

  // Diskon lewat menu ⋯ Lainnya.
  await page.getByRole('button', { name: 'Lainnya', exact: true }).click()
  await page.getByRole('button', { name: 'Diskon', exact: true }).click()
  const discount = dialogWith(page, 'Diskon Transaksi')
  await discount.getByRole('spinbutton').fill('10')
  const reason = discount.getByRole('button', { name: 'Karyawan', exact: true })
  if (await reason.isVisible()) await reason.click()
  await discount.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(discount).toBeHidden()
  await expect(page.getByRole('button', { name: /^Subtotal .*Diskon.*−Rp/ })).toBeVisible() // rincian ringkas

  // Total & Bayar selalu terlihat di tablet 1280×800.
  const pay = page.getByRole('button', { name: /^Bayar •/ })
  await expect(pay).toBeInViewport({ ratio: 1 })

  // Tutup (open bill) → buka lagi dari Pesanan Terbuka, state utuh.
  await page.getByRole('button', { name: 'Tutup', exact: true }).click()
  await expect(page.getByText('Siap untuk pesanan baru')).toBeVisible()
  await page.getByRole('button', { name: 'Pesanan Terbuka', exact: true }).click()
  await page.getByRole('button', { name: /Meja Teras/ }).first().click()
  await expect(page.getByText('Tambahan baru (1)')).toBeVisible()

  // Kirim tambahan → semua item pindah ke grup "Sudah dikirim".
  await page.getByRole('button', { name: 'Kirim ke Dapur/Bar' }).click()
  await expect(page.getByRole('button', { name: /Sudah dikirim \(3\)/ })).toBeVisible()
  await expect(page.getByText(/Tambahan baru/)).toHaveCount(0)

  const items = (await idbAll<ItemRow>(page, 'orderItems')).filter((i) => !i.removed)
  expect(items.find((i) => i.productName === 'Roti Bakar Coklat Keju')).toMatchObject({ qty: 2, notes: 'potong dua' })

  await pay.click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = dialogWith(page, 'Pembayaran Tunai')
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
})

test('banner printer bermasalah tidak memakan tinggi di Kasir (cukup chip di header)', async ({ page }) => {
  await completeOnboarding(page)
  await openShift(page)
  await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('kione-pos')
        req.onsuccess = () => {
          const tx = req.result.transaction('printJobs', 'readwrite')
          tx.objectStore('printJobs').put({ id: 'pj-e2e', status: 'FAILED', station: 'cashier', createdAt: Date.now(), updatedAt: Date.now() })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  // Tulisan IndexedDB mentah tak memicu liveQuery — muat ulang & masuk lagi supaya dibaca ulang.
  await page.reload()
  await page.getByRole('button', { name: /^Masuk sebagai Admin E2E,/ }).click()
  for (const d of '246810') await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('link', { name: 'Riwayat', exact: true }).click()
  await expect(page.getByText(/cetakan bermasalah — periksa printer/)).toBeVisible()
  await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  await expect(page.getByRole('button', { name: /cetak bermasalah/ })).toBeVisible()
  await expect(page.getByText(/cetakan bermasalah — periksa printer/)).toHaveCount(0)
})
