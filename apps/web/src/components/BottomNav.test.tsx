import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BottomNav } from './BottomNav.jsx'

describe('BottomNav', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the three tabs, with Wager in place of Teams', () => {
    render(<BottomNav route="game" onNavigate={vi.fn()} />)

    for (const label of ['Game', 'Scoreboard', 'Wager']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // Teams kept its route but gave up the nav slot.
    expect(screen.queryByRole('button', { name: 'Teams' })).toBeNull()
  })

  it('keeps Roster off the bar while its page stays reachable', () => {
    // The tab is switched off in BottomNav, not deleted: #/roster still routes
    // to the page, so opening it must not light up some other tab.
    render(<BottomNav route="roster" onNavigate={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Roster' })).toBeNull()
    for (const label of ['Game', 'Scoreboard', 'Wager']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('navigates to the tapped route', () => {
    const onNavigate = vi.fn()
    render(<BottomNav route="game" onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wager' }))
    expect(onNavigate).toHaveBeenCalledWith('wager')

    fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
    expect(onNavigate).toHaveBeenCalledWith('scoreboard')
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

    for (const label of ['Game', 'Scoreboard', 'Wager']) {
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
