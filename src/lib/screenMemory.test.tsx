import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { clearScreenMemory, useScreenState } from './screenMemory'

function Filter() {
  const [value, setValue] = useScreenState('tes.filter', 'semua')
  return <button onClick={() => setValue('lunas')}>{value}</button>
}

afterEach(clearScreenMemory)

describe('useScreenState', () => {
  it('filter bertahan saat layar ditutup lalu dibuka lagi (pindah modul)', () => {
    const first = render(<Filter />)
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button')).toHaveTextContent('lunas')
    first.unmount()
    render(<Filter />)
    expect(screen.getByRole('button')).toHaveTextContent('lunas')
  })
})
