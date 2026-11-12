import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings } from '@/db/repositories/settings'
import { createUser } from '@/db/repositories/users'
import { useSessionStore } from '@/state/sessionStore'
import { AccountPicker, LoginScreen } from '@/features/auth/LoginScreen'

vi.mock('@/native/haptics', () => ({ tapHaptic: vi.fn() }))

beforeEach(async () => {
  await resetLocalDb()
  localStorage.clear()
  await ensureDefaultSettings()
})

describe('layar pilih akun', () => {
  it('kerangka saat memuat, pesan + tindakan saat tak ada akun', () => {
    const { rerender } = render(<AccountPicker users={undefined} onSelect={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Pilih akun untuk masuk' }).parentElement?.querySelector('[aria-busy="true"]')).not.toBeNull()
    rerender(<AccountPicker users={[]} onSelect={() => {}} />)
    expect(screen.getByText('Belum ada akun aktif di perangkat ini')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Muat ulang' })).toBeInTheDocument()
  })

  it('PIN salah: pesan error, lalu PIN dikosongkan; PIN benar masuk', async () => {
    await createUser({ name: 'Kece Visual', role: 'administrator', pin: '2468' })
    render(<LoginScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Masuk sebagai Kece Visual, Administrator' }))
    for (const d of '1111') fireEvent.click(screen.getByRole('button', { name: d }))
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByText(/PIN salah\. Sisa percobaan/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('PIN 0 dari minimal 4 digit')).toBeInTheDocument(), { timeout: 2000 })

    for (const d of '2468') fireEvent.click(screen.getByRole('button', { name: d }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    })
    await waitFor(() => expect(useSessionStore.getState().currentUser?.name).toBe('Kece Visual'))
  })
})
