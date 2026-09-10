import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '@/app/ErrorBoundary'

function Boom({ crash }: { crash: boolean }): JSX.Element {
  if (crash) throw new Error('meledak')
  return <p>konten sehat</p>
}

describe('ErrorBoundary', () => {
  it('menampilkan anak selama tidak ada error', () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('konten sehat')).toBeInTheDocument()
  })

  it('menangkap error render dan menampilkan fallback dengan pesan + scope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary scope="layar Kasir">
        <Boom crash />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/Terjadi kesalahan pada layar Kasir/)).toBeInTheDocument()
    expect(screen.getByText('meledak')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('"Coba lagi" me-render ulang anak yang sudah pulih', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Flaky() {
      // modul-level flag supaya render kedua tidak melempar lagi
      return <Boom crash={Flaky.crash} />
    }
    Flaky.crash = true

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByText('meledak')).toBeInTheDocument()

    Flaky.crash = false
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(screen.getByText('konten sehat')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('memakai fallback kustom bila diberikan', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary fallback={(err) => <p>custom: {err.message}</p>}>
        <Boom crash />
      </ErrorBoundary>,
    )
    expect(screen.getByText('custom: meledak')).toBeInTheDocument()
    spy.mockRestore()
  })
})
