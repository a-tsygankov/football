import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SwUpdateBanner } from './SwUpdateBanner.jsx'

afterEach(cleanup)

describe('SwUpdateBanner', () => {
  it('says a new version is ready to install', () => {
    render(<SwUpdateBanner onReload={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent(/new version/i)
  })

  it('applies the waiting update when the reload button is pressed', () => {
    const onReload = vi.fn()
    render(<SwUpdateBanner onReload={onReload} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /reload to update/i }))

    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('can be put off, because a game night should not be interrupted', () => {
    // Unlike the minClientVersion banner, this update is optional: the
    // build in the tab still talks to the same API. Dismissing leaves the
    // worker waiting, so the prompt returns on the next launch.
    const onDismiss = vi.fn()
    render(<SwUpdateBanner onReload={vi.fn()} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: /later/i }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('announces politely rather than interrupting, unlike the version floor banner', () => {
    render(<SwUpdateBanner onReload={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
