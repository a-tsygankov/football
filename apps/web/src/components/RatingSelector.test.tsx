import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RatingSelector } from './RatingSelector.jsx'

afterEach(() => {
  cleanup()
})

describe('RatingSelector', () => {
  it('emits half-star integers via the half-overlay buttons', () => {
    const handle = vi.fn()
    render(<RatingSelector value={0} onChange={handle} />)

    // The 4th star's left half = 3.5 stars = 7 half-stars.
    fireEvent.click(screen.getByRole('button', { name: '3.5 stars' }))
    expect(handle).toHaveBeenCalledWith(7)

    // The 5th star's right half = 5 stars = 10 half-stars.
    fireEvent.click(screen.getByRole('button', { name: '5.0 stars' }))
    expect(handle).toHaveBeenCalledWith(10)
  })

  it('keyboard arrows step by single half-stars; Shift steps by full stars', () => {
    const handle = vi.fn()
    render(<RatingSelector value={4} onChange={handle} />)
    const slider = screen.getByRole('slider')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(handle).toHaveBeenLastCalledWith(5)

    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true })
    expect(handle).toHaveBeenLastCalledWith(6)

    fireEvent.keyDown(slider, { key: 'Home' })
    expect(handle).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(slider, { key: 'End' })
    expect(handle).toHaveBeenLastCalledWith(10)
  })

  it('clamps the displayed value into the legal half-star range', () => {
    render(<RatingSelector value={42} onChange={() => {}} />)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '5.0 stars')
  })
})
