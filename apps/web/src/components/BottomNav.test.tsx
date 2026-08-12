import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BottomNav } from './BottomNav.jsx'

describe('BottomNav', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the four tabs, with Wager in place of Teams', () => {
    render(<BottomNav route="game" onNavigate={vi.fn()} />)

    for (const label of ['Game', 'Scoreboard', 'Wager', 'Roster']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // Teams kept its route but gave up the nav slot.
    expect(screen.queryByRole('button', { name: 'Teams' })).toBeNull()
  })

  it('navigates to the tapped route', () => {
    const onNavigate = vi.fn()
    render(<BottomNav route="game" onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wager' }))
    expect(onNavigate).toHaveBeenCalledWith('wager')

    fireEvent.click(screen.getByRole('button', { name: 'Roster' }))
    expect(onNavigate).toHaveBeenCalledWith('roster')
  })

  it('marks the current route as the active tab', () => {
    // Previously the active tab was inferred by measuring which section sat
    // nearest the top of the viewport. It is now just the route, so there is
    // no scroll listener and no ambiguity when two sections were both visible.
    render(<BottomNav route="scoreboard" onNavigate={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Scoreboard' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: 'Game' })).not.toHaveAttribute('aria-current')
  })

  it('marks nothing active on a route with no tab', () => {
    // #/teams and #/settings are reachable but have no bar entry.
    render(<BottomNav route="teams" onNavigate={vi.fn()} />)

    for (const label of ['Game', 'Scoreboard', 'Wager', 'Roster']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('re-taps the current tab without erroring', () => {
    const onNavigate = vi.fn()
    render(<BottomNav route="wager" onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wager' }))
    expect(onNavigate).toHaveBeenCalledWith('wager')
  })
})
