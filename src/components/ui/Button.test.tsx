import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/Button'
import { MOTION } from '@/lib/motion'

vi.mock('@/native/haptics', () => ({ tapHaptic: vi.fn() }))

afterEach(() => vi.useRealTimers())

describe('Button', () => {
  it('disabled tidak memicu onClick', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Simpan
      </Button>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading: aria-busy, nonaktif, dan klik diabaikan', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Bayar
      </Button>,
    )
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('aksi async mencegah klik ganda walau parent tak mengatur disabled/loading', async () => {
    let finish: () => void = () => {}
    const onClick = vi.fn(() => new Promise<void>((r) => (finish = r)))
    render(<Button onClick={onClick}>Tutup Shift</Button>)
    const btn = screen.getByRole('button', { name: 'Tutup Shift' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(btn).toHaveAttribute('aria-busy', 'true')
    await act(async () => finish())
    expect(btn).not.toHaveAttribute('aria-busy')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('label tetap di DOM saat loading (lebar tak berubah)', () => {
    render(<Button loading>Selesaikan Pembayaran</Button>)
    expect(screen.getByText('Selesaikan Pembayaran').closest('span')).toHaveClass('invisible')
  })

  it('showSuccess: centang sebentar lalu kembali normal, tanpa memblokir klik berikutnya', async () => {
    vi.useFakeTimers()
    const onClick = vi.fn(() => Promise.resolve())
    render(
      <Button showSuccess onClick={onClick}>
        Cetak
      </Button>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(screen.getByText('Berhasil')).toBeInTheDocument()
    expect(screen.getByRole('button')).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onClick).toHaveBeenCalledTimes(2)
    act(() => vi.advanceTimersByTime(MOTION.success))
    expect(screen.queryByText('Berhasil')).toBeNull()
    expect(screen.getByText('Cetak').closest('span')).not.toHaveClass('invisible')
  })

  it('tombol ikon memakai aria-label sebagai nama', () => {
    render(<Button aria-label="Hapus item" leftIcon={<span>×</span>} />)
    expect(screen.getByRole('button', { name: 'Hapus item' })).toBeInTheDocument()
  })
})
