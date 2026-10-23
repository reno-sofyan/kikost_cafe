import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewApp } from './ReviewApp'
import { reviewIdFromPath } from './reviewPath'

const ID = '3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b'
const PAGE = { business: { name: 'Kinara Cafe', logoDataUrl: null }, orderNumber: 'TRX-00128', paidAt: 1761200000000, review: null, googleReviewUrl: 'https://g.page/r/kinara/review' }

function mockFetch(responses: { status: number; body: unknown }[]) {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce({ ok: r.status < 400, status: r.status, json: async () => r.body })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('ReviewApp', () => {
  it('id dari path', () => {
    expect(reviewIdFromPath(`/ulasan/${ID}`)).toBe(ID)
    expect(reviewIdFromPath(`/ulasan/${ID}/`)).toBe(ID)
  })

  it('bintang 5 → kirim → terima kasih + tombol Google Maps', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: PAGE },
      { status: 201, body: { ...PAGE, review: { rating: 5, comment: 'Enak' } } },
    ])
    render(<ReviewApp orderId={ID} />)
    expect(await screen.findByText('Kinara Cafe')).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: '5 bintang' }))
    await userEvent.type(screen.getByRole('textbox'), 'Enak')
    await userEvent.click(screen.getByRole('button', { name: 'Kirim Ulasan' }))
    expect(await screen.findByText('Terima kasih atas ulasannya!')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Tulis ulasan di Google Maps' }).getAttribute('href')).toBe(PAGE.googleReviewUrl)
    expect(fetchFn).toHaveBeenLastCalledWith(`/api/ulasan/${ID}`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ rating: 5, comment: 'Enak' }) }))
  })

  it('bintang 1–3 tidak diarahkan ke Google Maps', async () => {
    mockFetch([{ status: 200, body: { ...PAGE, review: { rating: 2, comment: '' } } }])
    render(<ReviewApp orderId={ID} />)
    expect(await screen.findByText('Masukan Anda akan kami tindak lanjuti.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Tulis ulasan di Google Maps' })).toBeNull()
  })

  it('struk belum tersinkron → pesan dari server', async () => {
    mockFetch([{ status: 404, body: { error: 'Struk belum tercatat di server. Coba lagi beberapa menit lagi.' } }])
    render(<ReviewApp orderId={ID} />)
    expect(await screen.findByText(/Struk belum tercatat di server/)).toBeTruthy()
  })
})
