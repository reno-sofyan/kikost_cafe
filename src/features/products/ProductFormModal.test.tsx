import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { ProductFormModal } from './ProductFormModal'

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.bulkPut([
    { id: 'c-masakan', name: 'Masakan', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'c-minum', name: 'Minuman Dingin', sortOrder: 1, active: true, createdAt: 1, updatedAt: 1 },
  ])
})

describe('ProductFormModal', () => {
  // Regresi: kategori dimuat async, jadi dulu state kategori tetap kosong padahal
  // <select> tampak memilih kategori pertama → "Nama, kategori, dan SKU wajib diisi".
  it('bisa menyimpan produk baru tanpa mengganti kategori yang tampil default', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ProductFormModal initial={null} onClose={onClose} />)

    await screen.findByRole('option', { name: 'Masakan' })
    const [nameInput] = screen.getAllByRole('textbox')
    await user.type(nameInput!, 'Nasi Goreng')
    const skuInput = screen.getByText('SKU').parentElement!.querySelector('input')!
    await user.type(skuInput, 'NG-01')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const saved = await db.products.toArray()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'Nasi Goreng', sku: 'NG-01', categoryId: 'c-masakan' })
  })

  it('pesan error menyebut isian yang benar-benar kosong', async () => {
    const user = userEvent.setup()
    render(<ProductFormModal initial={null} onClose={() => {}} />)
    await screen.findByRole('option', { name: 'Masakan' })
    await user.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(await screen.findByText('Nama, SKU wajib diisi.')).toBeInTheDocument()
  })
})
