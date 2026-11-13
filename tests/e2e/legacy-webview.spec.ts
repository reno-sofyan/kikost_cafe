import { expect, test } from '@playwright/test'
import { completeOnboarding, openShift } from './helpers'

/**
 * Meniru WebView Android lama (mis. Galaxy Tab S5e dengan WebView bawaan pabrik, Chrome 86):
 * API JS baru dihapus sebelum aplikasi dimuat, `aspect-ratio` dianggap tak dikenal.
 * CSS hasil build juga diperiksa agar tak memakai fitur yang diabaikan Chromium 80–87.
 */
test.use({
  viewport: { width: 1280, height: 728 },
  userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-T725; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Safari/537.36',
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulasi Chromium 86
    delete Array.prototype.at
    // @ts-expect-error simulasi Chromium 86
    delete String.prototype.at
    // @ts-expect-error simulasi Chromium 86
    delete Object.hasOwn
    const supports = CSS.supports.bind(CSS)
    CSS.supports = ((a: string, b?: string) => (/aspect-ratio/.test(a) ? false : b === undefined ? supports(a) : supports(a, b))) as typeof CSS.supports
    const kill = () => {
      const s = document.createElement('style')
      s.textContent = '*{aspect-ratio:auto !important}'
      document.head.appendChild(s)
    }
    if (document.head) kill()
    else document.addEventListener('DOMContentLoaded', kill)
  })
})

test('CSS hasil build aman untuk WebView Chromium 80–87', async ({ page }) => {
  await page.goto('/')
  const css = await page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')]
    return (await Promise.all(links.map((l) => fetch(l.href).then((r) => r.text())))).join('\n')
  })
  expect(css.length).toBeGreaterThan(1000)
  // `inset` (Chrome 87) — hanya variabel --tw-ring-inset yang boleh.
  expect(css.match(/(?:^|[;{\s])inset:/g) ?? []).toEqual([])
  expect(css).not.toContain(':where(')
  // Setiap dvh didahului cadangan vh untuk properti yang sama.
  for (const m of css.matchAll(/([a-z-]+):([^;}]*dvh[^;}]*)/g)) {
    expect(css.slice(0, m.index)).toContain(`${m[1]}:${m[2].replace(/(\d)dvh/g, '$1vh')};`)
  }
})

test('minimarket berjalan normal di WebView Chrome 86 (gambar produk, Tambah Printer, Export Nota PDF)', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await completeOnboarding(page, { businessType: 'Minimarket & Ritel', taxPercent: '0' })
  await openShift(page)

  // Kotak gambar produk tetap punya tinggi (aspect-ratio lewat JS).
  await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  const thumb = page.getByRole('button', { name: /^Tambah Air Mineral/ }).first().locator('> *').first()
  await expect.poll(async () => (await thumb.boundingBox())?.height ?? 0).toBeGreaterThan(60)

  // Bayar dengan Export Nota ke PDF menyala (jsPDF memakai Array.prototype.at).
  await page.getByRole('button', { name: /^Tambah Air Mineral.* ke keranjang/ }).click()
  await page.getByRole('button', { name: /^Bayar/ }).first().click()
  await page.getByText('Export Nota ke PDF').click()
  await page.getByRole('button', { name: 'Uang pas' }).click()
  const download = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null)
  await page.getByRole('button', { name: 'Selesaikan pembayaran' }).click()
  await expect(page.getByText(/Pembayaran Berhasil|Transaksi berhasil|Lunas/i).first()).toBeVisible({ timeout: 15_000 })
  await download

  // Tambah Printer: dialog tampil di tengah layar & bisa disimpan.
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
  await page.getByRole('button', { name: 'Printer', exact: true }).click()
  await page.getByRole('button', { name: '+ Tambah Printer' }).click()
  const name = page.getByPlaceholder('Nama printer')
  await expect(name).toBeInViewport({ ratio: 1 })
  await name.fill('Kasir Depan')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Kasir Depan')).toBeVisible()

  // Tentang: versi WebView & saran pembaruan.
  await page.getByRole('button', { name: 'Tentang', exact: true }).click()
  await expect(page.getByText('Chrome 86', { exact: true })).toBeVisible()
  await expect(page.getByText(/Android System WebView/)).toBeVisible()

  expect(errors).toEqual([])
})
