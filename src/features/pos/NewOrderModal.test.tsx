import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { resetLocalDb } from '@/test/db'
import { db } from '@/db/schema'
import { NewOrderModal, type NewOrderModalProps } from '@/features/pos/NewOrderModal'

vi.mock('@/native/haptics', () => ({ tapHaptic: vi.fn() }))

beforeEach(async () => {
  await resetLocalDb()
  await db.cafeTables.put({ id: 't1', name: 'Meja 1', area: '', capacity: 4, status: 'available', currentOrderId: null, occupiedSince: null, guestCount: null, createdAt: 1, updatedAt: 1 } as never)
})

const base = (over: Partial<NewOrderModalProps> = {}): NewOrderModalProps => ({
  orderTypes: ['dine_in', 'takeaway', 'delivery'],
  showTables: true,
  showWaiter: false,
  showHppBilling: true,
  showMarketingBilling: true,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  ...over,
})

describe('modal Pesanan Baru', () => {
  it('meja tampil untuk dine-in, disembunyikan untuk takeaway & online (ruang tamu tetap dicadangkan)', async () => {
    render(<NewOrderModal {...base()} />)
    expect(await screen.findByRole('group', { name: 'Meja' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Takeaway' }))
    expect(screen.queryByRole('group', { name: 'Meja' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tambah tamu' })).toBeNull() // tersembunyi, tapi ruangnya tetap
    expect(screen.getByRole('button', { name: 'Tambah tamu', hidden: true }).closest('[aria-hidden="true"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    expect(screen.queryByRole('group', { name: 'Meja' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Platform' })).toBeInTheDocument()
  })

  it('Mulai Pesanan nonaktif selama data wajib belum lengkap, dengan alasan terlihat', () => {
    const onConfirm = vi.fn()
    render(<NewOrderModal {...base({ onConfirm })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Marketing' }))
    expect(screen.getByRole('button', { name: 'Mulai Pesanan' })).toBeDisabled()
    expect(screen.getByText('Pilih sales')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'KOL' }))
    expect(screen.getByText('Pilih KOL atau tulis namanya')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nama KOL lain'), { target: { value: 'Dina' } })
    expect(screen.getByRole('button', { name: 'Mulai Pesanan' })).toBeEnabled()
  })

  it('kantin: nama pembeli wajib (bertanda *); Enter mengirim bila lengkap — data yang dikirim tak berubah', () => {
    const onConfirm = vi.fn()
    render(<NewOrderModal {...base({ orderTypes: ['dine_in', 'takeaway'], showTables: false, requireBuyerName: true, showHppBilling: false, showMarketingBilling: false, onConfirm })} />)
    expect(screen.getByRole('button', { name: 'Mulai Pesanan' })).toBeDisabled()
    expect(screen.getByText('Isi nama pembeli')).toBeInTheDocument()
    const name = screen.getByPlaceholderText('mis. "Budi"')
    fireEvent.change(name, { target: { value: 'Andi' } })
    fireEvent.submit(name.closest('form')!)
    expect(onConfirm).toHaveBeenCalledWith({
      billing: undefined,
      type: 'dine_in',
      customerId: undefined,
      guestCount: undefined,
      notes: 'Andi',
      tableId: undefined,
      waiter: null,
      onlinePlatform: undefined,
      onlineOrderRef: undefined,
    })
  })
})
