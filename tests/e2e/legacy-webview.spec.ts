import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, openShift } from './helpers'

/**
 * Meniru WebView Android lama — Galaxy Tab S5e (SM-T720, Android 10, One UI 2.5) minimarket ber-WebView
 * bawaan pabrik Chrome 81.0.4044.148: API JS baru dihapus sebelum aplikasi dimuat, `aspect-ratio`
 * dianggap tak dikenal, dan flex `gap` diganti cadangan margin.
 * CSS hasil build juga diperiksa agar tak memakai fitur yang diabaikan Chromium 80–87.
 */
test.use({
  viewport: { width: 1280, height: 728 },
  userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-T720; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/81.0.4044.148 Safari/537.36',
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulasi Chromium 81
    delete Array.prototype.at
    // @ts-expect-error simulasi Chromium 81
    delete String.prototype.at
    // @ts-expect-error simulasi Chromium 81
    delete Object.hasOwn
    // @ts-expect-error simulasi Chromium 81
    delete String.prototype.replaceAll
    window.__KIONE_EMULATE_NO_FLEX_GAP__ = true
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

test('minimarket berjalan normal di WebView Chrome 81 (gambar produk, Tambah Printer, Export Nota PDF)', async ({ page }) => {
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
  await expect(page.getByText('Chrome 81', { exact: true })).toBeVisible()
  await expect(page.getByText(/Android System WebView/)).toBeVisible()

  expect(errors).toEqual([])
})

/** Posisi semua elemen terlihat di layar (dibulatkan), urut DOM. */
async function visibleBoxes(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main *, nav *, aside *'))
      .filter((el) => el.offsetParent !== null && el.childElementCount === 0)
      .map((el) => {
        const r = el.getBoundingClientRect()
        return `${el.tagName} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`
      }),
  )
}

/**
 * Sama bila tag sama dan setiap angka posisi/ukuran selisih ≤ 2px — teks berisi jam bisa
 * berganti menit di antara dua jalan (lebar teks bergeser 1px), bukan karena celah.
 */
function sameBox(a: string, b: string | undefined) {
  if (!b || a.split(' ')[0] !== b.split(' ')[0]) return false
  const na = a.match(/-?\d+/g) ?? []
  const nb = b.match(/-?\d+/g) ?? []
  return na.length === nb.length && na.every((n, i) => Math.abs(Number(n) - Number(nb[i])) <= 2)
}

/** Layar minimarket yang dibandingkan; setiap langkah diakhiri tangkapan posisi. */
const SCREENS: [string, (page: Page) => Promise<void>][] = [
  ['Beranda', async () => {}],
  ['Kasir + keranjang', async (page) => {
    await page.getByRole('link', { name: 'Kasir', exact: true }).click()
    for (const name of [/Air Mineral/, /Beras 5kg/, /Gula Pasir/]) {
      await page.getByRole('button', { name: new RegExp(`^Tambah ${name.source}.* ke keranjang`) }).first().click()
    }
  }],
  ['Pembayaran', async (page) => page.getByRole('button', { name: /^Bayar/ }).first().click()],
  ['Produk', async (page) => {
    await page.getByRole('link', { name: 'Produk', exact: true }).click()
    // Urutan daftar mengikuti ID acak — saring ke satu produk agar kedua jalan sebanding.
    await page.getByPlaceholder(/Cari/).first().fill('Air Mineral')
  }],
  ...['Riwayat', 'Stok', 'Pembelian', 'Pelanggan', 'Promo', 'Laporan', 'Shift', 'Pengeluaran'].map(
    (menu): [string, (page: Page) => Promise<void>] => [menu, async (page) => page.getByRole('link', { name: menu, exact: true }).click()],
  ),
  ['Pengaturan › Printer', async (page) => {
    await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
    await page.getByRole('button', { name: 'Printer', exact: true }).click()
  }],
]

for (const viewport of [
  { width: 1280, height: 728 },
  { width: 1024, height: 576 },
]) {
  test(`flex gap di WebView < Chrome 84: tata letak minimarket sama dengan gap asli (${viewport.width}×${viewport.height})`, async ({ browser }) => {
    test.slow()
    const runs: Record<string, string[]>[] = []
    for (const emulate of [false, true]) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      if (emulate) await page.addInitScript(() => (window.__KIONE_EMULATE_NO_FLEX_GAP__ = true))
      await completeOnboarding(page, { businessType: 'Minimarket & Ritel', taxPercent: '0' })
      await openShift(page)
      const shots: Record<string, string[]> = {}
      for (const [name, step] of SCREENS) {
        await step(page)
        await page.waitForTimeout(600)
        shots[name] = await visibleBoxes(page)
      }
      runs.push(shots)
      await context.close()
    }
    const [native, fallback] = runs
    for (const [name] of SCREENS) {
      expect(native[name].length, name).toBeGreaterThan(20)
      const diff = native[name].flatMap((box, i) => (sameBox(box, fallback[name][i]) ? [] : [`${box}  →  ${fallback[name][i]}`]))
      expect(diff.slice(0, 10), name).toEqual([])
    }
  })
}
