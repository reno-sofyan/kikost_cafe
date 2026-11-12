import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BootTimeoutError,
  bootErrorMessage,
  readBootBrand,
  rememberBootBrand,
  remainingSplashMs,
  shouldShowResume,
  splashStyleFor,
  withBootTimeout,
} from './bootSplash'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('durasi splash', () => {
  it('data siap sebelum durasi minimal → tunggu sisa minimalnya', () => {
    expect(remainingSplashMs(1000, 1200, 900)).toBe(700)
  })
  it('data siap tepat/sesudah durasi minimal → langsung ditutup', () => {
    expect(remainingSplashMs(1000, 1900, 900)).toBe(0)
    expect(remainingSplashMs(1000, 4000, 900)).toBe(0)
  })
})

describe('batas waktu inisialisasi', () => {
  it('meneruskan hasil bila selesai tepat waktu', async () => {
    await expect(withBootTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })
  it('meneruskan error aslinya', async () => {
    await expect(withBootTimeout(Promise.reject(new Error('rusak')), 1000)).rejects.toThrow('rusak')
  })
  it('database tak merespons → BootTimeoutError, bukan menunggu selamanya', async () => {
    vi.useFakeTimers()
    const pending = withBootTimeout(new Promise(() => {}), 15_000)
    vi.advanceTimersByTime(15_000)
    await expect(pending).rejects.toBeInstanceOf(BootTimeoutError)
  })
})

describe('pesan error inisialisasi', () => {
  it('membedakan timeout, penyimpanan penuh, berkas gagal dimuat, dan lainnya', () => {
    expect(bootErrorMessage(new BootTimeoutError()).title).toBe('Database lokal tidak merespons')
    expect(bootErrorMessage(Object.assign(new Error('x'), { name: 'QuotaExceededError' })).title).toBe('Penyimpanan perangkat penuh')
    expect(bootErrorMessage(new TypeError('Failed to fetch dynamically imported module')).title).toBe('Berkas aplikasi belum termuat')
    expect(bootErrorMessage(new Error('UnknownError')).title).toBe('Data lokal gagal dibuka')
  })
})

describe('gaya splash per POS', () => {
  it('kafe/kantin/laundry gaya indigo; minimarket gaya ritel; sebelum onboarding gaya Kione standar', () => {
    expect(splashStyleFor({ businessType: 'cafe_resto', businessName: 'Kopi' })).toMatchObject({ variant: 'default', icon: 'coffee', label: 'Kafe & Restoran' })
    expect(splashStyleFor({ businessType: 'kantin', businessName: '' })).toMatchObject({ variant: 'default', icon: 'bowl' })
    expect(splashStyleFor({ businessType: 'laundry', businessName: '' })).toMatchObject({ variant: 'default', icon: 'washer' })
    expect(splashStyleFor({ businessType: 'minimarket', businessName: '' })).toMatchObject({ variant: 'retail', icon: 'cart' })
    expect(splashStyleFor(null)).toMatchObject({ variant: 'default', label: '' })
  })
  it('jenis usaha diingat lintas cold start; data rusak diabaikan', () => {
    expect(readBootBrand()).toBeNull()
    rememberBootBrand({ businessType: 'minimarket', businessName: 'Toko Makmur' })
    expect(readBootBrand()).toEqual({ businessType: 'minimarket', businessName: 'Toko Makmur' })
    localStorage.setItem('kione.bootBrand', '{"businessType":"bengkel"}')
    expect(readBootBrand()).toBeNull()
    localStorage.setItem('kione.bootBrand', '{rusak')
    expect(readBootBrand()).toBeNull()
  })
})

describe('kembali dari background', () => {
  it('indikator hanya setelah cukup lama di background', () => {
    expect(shouldShowResume(null, 100_000)).toBe(false)
    expect(shouldShowResume(90_000, 100_000)).toBe(false)
    expect(shouldShowResume(60_000, 100_000)).toBe(true)
  })
})

describe('Coba lagi untuk berkas aplikasi yang gagal diunduh', () => {
  it('memuat ulang halaman (import() yang gagal diingat browser)', () => {
    expect(bootErrorMessage(new TypeError('Failed to fetch dynamically imported module: /src/App.tsx')).reload).toBe(true)
    expect(bootErrorMessage(new Error('UnknownError')).reload).toBeUndefined()
  })
})
