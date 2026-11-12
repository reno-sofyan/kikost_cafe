import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PinDots, PinPad } from '@/components/ui/PinPad'

vi.mock('@/native/haptics', () => ({ tapHaptic: vi.fn() }))

function Harness({ onSubmit = vi.fn(), onCancel }: { onSubmit?: () => void; onCancel?: () => void }) {
  const [pin, setPin] = useState('')
  return (
    <>
      <output data-testid="pin">{pin}</output>
      <PinDots length={pin.length} />
      <PinPad value={pin} onChange={setPin} onSubmit={onSubmit} onCancel={onCancel} />
    </>
  )
}

const pin = () => screen.getByTestId('pin').textContent

describe('PinPad', () => {
  it('angka menambah digit, hapus mengurangi, "Hapus" mengosongkan', () => {
    render(<Harness />)
    for (const d of '123') fireEvent.click(screen.getByRole('button', { name: d }))
    expect(pin()).toBe('123')
    expect(screen.getByText('PIN 3 dari minimal 4 digit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Hapus digit terakhir/ }))
    expect(pin()).toBe('12')
    fireEvent.click(screen.getByRole('button', { name: 'Hapus semua digit' }))
    expect(pin()).toBe('')
  })

  it('tahan tombol hapus mengosongkan seluruh PIN', () => {
    vi.useFakeTimers()
    render(<Harness />)
    for (const d of '1234') fireEvent.click(screen.getByRole('button', { name: d }))
    const del = screen.getByRole('button', { name: /Hapus digit terakhir/ })
    fireEvent.pointerDown(del)
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerUp(del)
    fireEvent.click(del)
    expect(pin()).toBe('')
    vi.useRealTimers()
  })

  it('tombol Masuk nonaktif (tetap terbaca) sampai PIN cukup panjang', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    for (const d of '12') fireEvent.click(screen.getByRole('button', { name: d }))
    const submit = screen.getByRole('button', { name: 'Masukkan 2 digit lagi' })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
    for (const d of '34') fireEvent.click(screen.getByRole('button', { name: d }))
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keyboard fisik: angka, Backspace, Enter, Escape', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onSubmit={onSubmit} onCancel={onCancel} />)
    for (const k of ['5', '6', 'x', '7', '8', '9']) fireEvent.keyDown(window, { key: k })
    expect(pin()).toBe('56789')
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(pin()).toBe('5678')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('PIN tak pernah tampil sebagai teks di keypad/indikator', () => {
    render(<PinDots length={3} />)
    expect(document.body.textContent).not.toMatch(/\d{3}/)
  })
})
