import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UpdateBanner } from './UpdateBanner.jsx'

afterEach(cleanup)

describe('UpdateBanner', () => {
  it('names both versions so the gap is legible', () => {
    render(
      <UpdateBanner
        clientVersion="0.1.3"
        minClientVersion="0.1.9"
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByText('0.1.3')).toBeInTheDocument()
    expect(screen.getByText('0.1.9')).toBeInTheDocument()
  })

  it('reloads when the button is pressed', () => {
    const onReload = vi.fn()
    render(
      <UpdateBanner
        clientVersion="0.1.3"
        minClientVersion="0.1.9"
        onReload={onReload}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('is announced as an alert', () => {
    render(
      <UpdateBanner
        clientVersion="0.1.3"
        minClientVersion="0.1.9"
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('offers no way to dismiss it', () => {
    // minClientVersion is a floor, not a suggestion — the only way out is
    // to reload. A dismiss affordance would let someone keep using a build
    // the worker has already declared too old.
    render(
      <UpdateBanner
        clientVersion="0.1.3"
        minClientVersion="0.1.9"
        onReload={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /dismiss|close|later/i })).toBeNull()
  })
})
