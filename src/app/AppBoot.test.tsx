import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AppBoot } from '@/app/AppBoot'
import { SPLASH_FADE_MS, SPLASH_MIN_MS, SPLASH_TIMEOUT_MS } from '@/lib/bootSplash'

vi.mock('@/native/splashScreen', () => ({ hideNativeSplash: vi.fn() }))

function Ready() {
  return <p>layar kasir</p>
}

const flush = () => act(async () => {})

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('AppBoot', () => {
  it('data lokal siap seketika: splash tetap tampil sampai durasi minimal, lalu memudar', async () => {
    render(<AppBoot load={() => Promise.resolve(Ready)} />)
    await flush()
    // Aplikasi sudah dirender di belakang splash.
    expect(screen.getByText('layar kasir')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Memuat Kione POS' })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(SPLASH_MIN_MS - 10))
    expect(screen.getByRole('status', { name: 'Memuat Kione POS' })).not.toHaveClass('kione-splash--leaving')
    act(() => vi.advanceTimersByTime(10))
    expect(screen.getByRole('status', { name: 'Memuat Kione POS' })).toHaveClass('kione-splash--leaving')
    act(() => vi.advanceTimersByTime(SPLASH_FADE_MS))
    expect(screen.queryByRole('status', { name: 'Memuat Kione POS' })).toBeNull()
  })

  it('gagal membuka database: pesan jelas + "Coba lagi" yang mengulang inisialisasi', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('UnknownError')).mockResolvedValueOnce(Ready)
    render(<AppBoot load={load} />)
    await flush()
    expect(screen.getByText('Data lokal gagal dibuka')).toBeInTheDocument()
    expect(screen.queryByText('layar kasir')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByText('layar kasir')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(SPLASH_MIN_MS + SPLASH_FADE_MS))
    expect(screen.queryByText('Data lokal gagal dibuka')).toBeNull()
    spy.mockRestore()
  })

  it('database tak merespons: berhenti menunggu dan menampilkan "Coba lagi"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppBoot load={() => new Promise(() => {})} />)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText('Menyiapkan data lokal…')).toHaveClass('opacity-100')
    await act(async () => {
      vi.advanceTimersByTime(SPLASH_TIMEOUT_MS)
    })
    expect(screen.getByText('Database lokal tidak merespons')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument()
    spy.mockRestore()
  })

  it('splash bergaya sesuai POS terakhir (minimarket = biru ritel) & menonjolkan Kione POS, bukan nama usaha', async () => {
    localStorage.setItem('kione.bootBrand', JSON.stringify({ businessType: 'minimarket', businessName: 'Toko Makmur' }))
    render(<AppBoot load={() => new Promise(() => {})} />)
    const splash = screen.getByRole('status', { name: 'Memuat Kione POS' })
    expect(splash).toHaveClass('bg-brand-600')
    expect(screen.queryByText('Toko Makmur')).toBeNull()
    expect(screen.getByText('POS')).toBeInTheDocument()
    expect(screen.getByText('Minimarket & Ritel')).toBeInTheDocument()
  })
})
