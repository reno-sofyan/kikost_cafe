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

/** Tenant milik kunci perangkat e2e (lihat playwright.sync.config / sync-backend.sh). */
async function e2eTenantForKey(deviceKey: string): Promise<string> {
  const cfg = await import('../../playwright.sync.config')
  return deviceKey === cfg.E2E_KANTIN_DEVICE_KEY ? cfg.E2E_KANTIN_TENANT : deviceKey === cfg.E2E_MULTI_DEVICE_KEY ? 'multi-e2e' : 'default'
}

/**
 * Hubungkan tablet ke backend seperti developer di lapangan (dipakai spec *.sync.spec.ts):
 * kode pasang dari /ops → Tentang → Mode Developer → tab Sinkronisasi (sudah terisi) → Simpan.
 * Tablet mendapat kunci perangkat SENDIRI untuk tenant milik `deviceKey`.
 */
export async function configureBackend(page: Page, apiUrl: string, deviceKey: string): Promise<void> {
  const cfg = await import('../../playwright.sync.config')
  const res = await fetch(`${cfg.E2E_API_URL}/ops/api/tenant/${await e2eTenantForKey(deviceKey)}/pairing-code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.E2E_OPS_TOKEN}` },
  })
  const { code } = (await res.json()) as { code: string }
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Tentang', exact: true }).click()
  await page.getByLabel('Alamat server').fill(apiUrl)
  await page.getByLabel('Kode pasang').fill(code)
  await page.getByRole('button', { name: 'Pasangkan', exact: true }).click()
  await expect(page.getByText('Mode Developer aktif')).toBeVisible()
  await page.getByRole('button', { name: 'Sinkronisasi' }).click()
  await expect(page.getByLabel('URL Backend')).toHaveValue(apiUrl)
  await page.getByRole('button', { name: 'Uji Koneksi' }).click()
  await expect(page.getByText('Koneksi backend berhasil.')).toBeVisible()
  await page.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByText('Konfigurasi disimpan.')).toBeVisible()
}

/** Sinkronkan sekarang lalu tunggu antrean kosong tanpa kegagalan. */
export async function waitForNoPending(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  // Setelah perangkat terpasang ke server, tab Sinkronisasi hanya muncul di Mode Developer.
  await page.getByRole('button', { name: 'Tentang', exact: true }).waitFor()
  if (!(await page.getByRole('button', { name: 'Sinkronisasi' }).isVisible())) await unlockDeveloperModeWithOps(page)
  await page.getByRole('button', { name: 'Sinkronisasi' }).click()
  await page.getByRole('button', { name: 'Sinkronkan Sekarang' }).click()
  await expect(page.getByText('Menunggu sinkronisasi: 0')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Gagal sinkronisasi: 0')).toBeVisible()
}

/** Tambah pengguna lewat Pengaturan → Pengguna. */
export async function addUser(page: Page, name: string, role: string, pin: string): Promise<void> {
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Pengguna', exact: true }).click()
  await page.getByRole('button', { name: '+ Pengguna Baru' }).click()
  await page.getByLabel('Nama', { exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Role' }).selectOption({ label: role })
  await page.getByLabel('PIN (4-8 digit)').fill(pin)
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText(name).first()).toBeVisible()
}

/** Absen manual di menu Absensi (pengecualian, disetujui Admin/Pemilik). Halaman Absensi harus sudah terbuka. */
export async function manualAttendance(page: Page, staffName: string, approverPin: string, reason = 'HP mati baterai'): Promise<void> {
  await page.getByRole('button', { name: 'Absen Manual' }).click()
  const staff = page.getByLabel('Karyawan')
  await staff.selectOption((await staff.locator('option', { hasText: `${staffName} — ` }).getAttribute('value'))!)
  await page.getByLabel('Alasan absen manual').fill(reason)
  await page.getByLabel('PIN penyetuju').fill(approverPin)
  await page.getByRole('button', { name: /^Catat Absen (Masuk|Pulang)$/ }).click()
}

/**
 * Buka Mode Developer (Pengaturan → Tentang) untuk tes tanpa backend: server peniru
 * menerima token, dan alamat server diisi sementara lalu dihapus lagi supaya tes lain
 * tetap berjalan tanpa sinkronisasi. Spec *.sync.spec.ts memakai token asli dari /ops.
 */
export async function unlockDeveloperModeMocked(page: Page): Promise<void> {
  await page.route('**/api/sync/developer-code/consume', (route) => route.fulfill({ json: { ok: true, createdAt: Date.now() } }))
  await page.evaluate(() => {
    localStorage.setItem('kione.sync.apiBaseUrl', 'http://e2e-backend.invalid')
    localStorage.setItem('kione.sync.deviceKey', 'e2e-device-key')
  })
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
  await page.getByRole('button', { name: 'Tentang', exact: true }).click()
  await page.getByLabel('Token developer').fill('1234')
  await page.getByRole('button', { name: 'Buka', exact: true }).click()
  await expect(page.getByText('Mode Developer aktif')).toBeVisible()
  await page.evaluate(() => {
    localStorage.removeItem('kione.sync.apiBaseUrl')
    localStorage.removeItem('kione.sync.deviceKey')
  })
}

/** Mode Developer dengan token asli dari /ops (spec *.sync.spec.ts dengan backend sungguhan). */
export async function unlockDeveloperModeWithOps(page: Page): Promise<void> {
  const cfg = await import('../../playwright.sync.config')
  // Token untuk tenant tablet ini (lintas tenant ditolak server) — dari /api/sync/whoami kuncinya.
  const deviceKey = await page.evaluate(() => localStorage.getItem('kione.sync.deviceKey'))
  const who = await fetch(`${cfg.E2E_API_URL}/api/sync/whoami`, { headers: { Authorization: `Bearer ${deviceKey}` } })
  const tenant = ((await who.json()) as { tenantId?: string }).tenantId ?? 'default'
  const res = await fetch(`${cfg.E2E_API_URL}/ops/api/tenant/${tenant}/developer-code`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.E2E_OPS_TOKEN}` } })
  const { code } = (await res.json()) as { code: string }
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
  await page.getByRole('button', { name: 'Tentang', exact: true }).click()
  if (await page.getByText('Mode Developer aktif').isVisible()) return
  await page.getByLabel('Token developer').fill(code)
  await page.getByRole('button', { name: 'Buka', exact: true }).click()
  await expect(page.getByText('Mode Developer aktif')).toBeVisible()
}
