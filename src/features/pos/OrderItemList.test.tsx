import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { OrderItemList } from '@/features/pos/OrderItemList'
import type { OrderItem } from '@/types/domain'

const item = (over: Partial<OrderItem>): OrderItem =>
  ({
    id: over.productName ?? 'x',
    orderId: 'o1',
    productId: 'p',
    productName: 'Produk',
    unitPrice: 10000,
    qty: 1,
    modifiers: [],
    notes: '',
    discountAmount: 0,
    lineTotal: 10000,
    kitchenStatus: 'new',
    kitchenPrintedAt: null,
    removed: false,
    voided: false,
    ...over,
  }) as OrderItem

const props = { orderId: 'o1', courseMode: false, heldCourse: null, onQtyChange: vi.fn(), onOpenItem: vi.fn() }

describe('daftar item keranjang', () => {
  it('repeat order: item yang sudah dikirim terpisah dari tambahan baru, grup lama bisa dilipat', () => {
    const items = [
      item({ productName: 'Kinara Brown', unitPrice: 25000, qty: 2, lineTotal: 50000, kitchenPrintedAt: 1 }),
      item({ productName: 'Lemon Tea', notes: 'less ice' }),
    ]
    render(<OrderItemList {...props} items={items} splitSent />)
    expect(screen.getByText('Sudah dikirim (1)')).toBeInTheDocument()
    expect(screen.getByText('Tambahan baru (1)')).toBeInTheDocument()
    expect(screen.getByText('"less ice"')).toBeInTheDocument()
    expect(screen.getByText('@ Rp25.000')).toBeInTheDocument() // harga satuan hanya bila qty > 1

    fireEvent.click(screen.getByRole('button', { name: /Sudah dikirim/ }))
    expect(screen.queryByText('Kinara Brown')).toBeNull()
    expect(screen.getByText('Lemon Tea')).toBeInTheDocument()
  })

  it('tanpa item terkirim (atau usaha tanpa dapur): satu daftar polos tanpa judul grup', () => {
    render(<OrderItemList {...props} items={[item({ productName: 'Croffle', kitchenPrintedAt: 1 })]} splitSent={false} />)
    expect(screen.queryByText(/Sudah dikirim/)).toBeNull()
    expect(screen.queryByText(/Tambahan baru/)).toBeNull()
  })

  it('stepper & tap nama meneruskan ke handler kasir', () => {
    const onQtyChange = vi.fn()
    const onOpenItem = vi.fn()
    const croffle = item({ productName: 'Croffle' })
    render(<OrderItemList {...props} items={[croffle]} splitSent onQtyChange={onQtyChange} onOpenItem={onOpenItem} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tambah jumlah Croffle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kurangi jumlah Croffle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Detail Croffle' }))
    expect(onQtyChange.mock.calls).toEqual([
      [croffle, 1],
      [croffle, -1],
    ])
    expect(onOpenItem).toHaveBeenCalledWith(croffle)
  })
})
