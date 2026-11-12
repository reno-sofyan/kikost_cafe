import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { notify } from '@/lib/notify'
import { MAX_VISIBLE_TOASTS, TOAST_DEDUPE_MS, useToastStore } from '@/state/toastStore'
import { ToastHost } from '@/components/ui/ToastHost'
import { ConfirmHost } from '@/components/ui/ConfirmHost'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { bannerConditions } from '@/lib/statusBanner'

vi.mock('@/native/haptics', () => ({ tapHaptic: vi.fn() }))

beforeEach(() => useToastStore.getState().clear())
afterEach(() => vi.useRealTimers())

describe('toast', () => {
  it('maks. 3 tampil; sisanya antre lalu muncul saat ada yang ditutup', () => {
    render(<ToastHost />)
    act(() => {
      for (let i = 1; i <= 5; i++) notify.info(`Pesan ${i}`)
    })
    expect(screen.getAllByRole('status')).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(screen.queryByText('Pesan 4')).toBeNull()
    act(() => notify.dismiss(useToastStore.getState().toasts[0]!.id))
    expect(screen.getByText('Pesan 4')).toBeInTheDocument()
  })

  it('pesan sama dalam waktu singkat tidak ditampilkan dua kali', () => {
    vi.useFakeTimers()
    const a = notify.error('Printer tidak terhubung')
    const b = notify.error('Printer tidak terhubung')
    expect(b).toBe(a)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    notify.warning('Printer tidak terhubung') // jenis lain = pesan lain
    expect(useToastStore.getState().toasts).toHaveLength(2)
    vi.advanceTimersByTime(TOAST_DEDUPE_MS + 1)
    notify.error('Printer tidak terhubung')
    expect(useToastStore.getState().toasts).toHaveLength(3)
  })

  it('sukses hilang sendiri ±2,5 detik; error menetap sampai ditutup (role alert)', () => {
    vi.useFakeTimers()
    render(<ToastHost />)
    act(() => {
      notify.success('Pesanan disimpan')
      notify.error('Gagal mencetak struk', { action: { label: 'Coba lagi', onAction: vi.fn() } })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal mencetak struk')
    act(() => vi.advanceTimersByTime(2500 + 200))
    expect(screen.queryByText('Pesanan disimpan')).toBeNull()
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('Gagal mencetak struk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abaikan notifikasi' }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText('Gagal mencetak struk')).toBeNull()
  })
})

describe('confirm()', () => {
  it('true bila dilanjutkan, false bila dibatalkan', async () => {
    render(<ConfirmHost />)
    let yes: Promise<boolean> = Promise.resolve(false)
    act(() => {
      yes = notify.confirm({ title: 'Batalkan pesanan?', confirmLabel: 'Ya, batalkan', tone: 'danger' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ya, batalkan' }))
    await expect(yes).resolves.toBe(true)

    let no: Promise<boolean> = Promise.resolve(true)
    act(() => {
      no = notify.confirm({ title: 'Tutup shift?' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    await expect(no).resolves.toBe(false)
  })
})

describe('dialog konfirmasi', () => {
  it('fokus ke Batal (bukan tombol merah), Esc menutup, fokus kembali ke pemicu', async () => {
    vi.useFakeTimers()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const onCancel = vi.fn()
    const { unmount } = render(<ConfirmDialog title="Void transaksi?" tone="danger" confirmLabel="Void" onCancel={onCancel} onConfirm={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Batal' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(300))
    expect(onCancel).toHaveBeenCalled()
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})

describe('banner status', () => {
  const base = { backendConfigured: true, isOnline: true, failedSync: 0, printFailures: 0, onRetrySync: () => {}, onOpenPrintQueue: () => {} }
  it('offline, sinkron gagal, printer — hilang saat pulih', () => {
    expect(bannerConditions(base)).toEqual([])
    expect(bannerConditions({ ...base, isOnline: false })[0]).toMatchObject({ key: 'offline', tone: 'warning' })
    expect(bannerConditions({ ...base, failedSync: 2 })[0]).toMatchObject({ tone: 'error', action: { label: 'Coba lagi' } })
    expect(bannerConditions({ ...base, printFailures: 1 })[0]).toMatchObject({ tone: 'warning', action: { label: 'Lihat' } })
    // Mode lokal (tanpa server): offline tak relevan.
    expect(bannerConditions({ ...base, backendConfigured: false, isOnline: false })).toEqual([])
  })
})
