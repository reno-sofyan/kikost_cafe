import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { OnboardingWizard } from './OnboardingWizard'

vi.mock('@/native/haptics', () => ({ tapHaptic: vi.fn() }))
afterEach(() => localStorage.clear())

describe('wizard Pengaturan Awal', () => {
  it('langkah pertama: tanpa tombol Kembali; Lanjut menyimpan progres', () => {
    render(<OnboardingWizard />)
    expect(screen.queryByRole('button', { name: 'Kembali' })).toBeNull()
    expect(screen.getByText('Langkah 1 dari 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.getByText('Langkah 2 dari 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kembali' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('kione.onboardingDraft') ?? '{}').step).toBe('profile')
    expect(screen.getByText('Progres tersimpan')).toBeInTheDocument()
  })

  it('dimuat ulang → lanjut dari langkah tersimpan dengan isian sebelumnya', () => {
    localStorage.setItem('kione.onboardingDraft', JSON.stringify({ step: 'profile', businessType: 'kantin', businessName: 'Kantin Bu Sari' }))
    render(<OnboardingWizard />)
    expect(screen.getByText('Langkah 2 dari 7')).toBeInTheDocument()
    expect(screen.getByLabelText('Nama Usaha')).toHaveValue('Kantin Bu Sari')
  })

  it('stepper: langkah selesai bisa diklik untuk kembali, langkah depan tidak', () => {
    localStorage.setItem('kione.onboardingDraft', JSON.stringify({ step: 'fiscal' }))
    render(<OnboardingWizard />)
    expect(screen.getByRole('button', { name: 'Langkah 5 dari 7, Konfigurasi Printer, belum dikerjakan' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Langkah 2 dari 7, Profil Usaha, selesai' }))
    expect(screen.getByText('Langkah 2 dari 7')).toBeInTheDocument()
  })

  it('Enter = lanjut, Esc = kembali (di luar kolom isian)', () => {
    render(<OnboardingWizard />)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(screen.getByText('Langkah 2 dari 7')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText('Langkah 1 dari 7')).toBeInTheDocument()
  })
})

describe('validasi per kolom', () => {
  it('Nama Usaha kosong: tetap di langkah Profil, error di bawah kolomnya', () => {
    localStorage.setItem('kione.onboardingDraft', JSON.stringify({ step: 'profile' }))
    render(<OnboardingWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.getByText('Langkah 2 dari 7')).toBeInTheDocument()
    expect(screen.getByLabelText('Nama Usaha').closest('.kione-field--error')).toHaveTextContent('Nama usaha wajib diisi')
    fireEvent.change(screen.getByLabelText('Nama Usaha'), { target: { value: 'Kopi Senja' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }))
    expect(screen.getByText('Langkah 3 dari 7')).toBeInTheDocument()
  })

  it('PIN tidak cocok: error di kolom Konfirmasi PIN', () => {
    localStorage.setItem('kione.onboardingDraft', JSON.stringify({ step: 'admin', businessName: 'Kopi Senja', adminName: 'Reno' }))
    render(<OnboardingWizard />)
    fireEvent.change(screen.getByLabelText('PIN (4-8 digit)'), { target: { value: '1234' } })
    fireEvent.change(screen.getByLabelText('Konfirmasi PIN'), { target: { value: '9999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Selesai & Mulai' }))
    expect(screen.getByLabelText('Konfirmasi PIN').closest('.kione-field--error')).toHaveTextContent('Konfirmasi PIN tidak cocok')
  })
})
