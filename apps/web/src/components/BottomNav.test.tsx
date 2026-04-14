import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomNav } from './BottomNav.jsx'

describe('BottomNav', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('scrolls to the implemented game and scoreboard sections', () => {
    const gameSection = document.createElement('section')
    gameSection.id = 'fc26-game-section'
    document.body.appendChild(gameSection)

    const scoreboardSection = document.createElement('section')
    scoreboardSection.id = 'fc26-scoreboard-section'
    document.body.appendChild(scoreboardSection)

    render(<BottomNav />)

    fireEvent.click(screen.getByRole('button', { name: 'Game' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    scrollIntoView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('keeps unfinished tabs disabled', () => {
    render(<BottomNav />)
    expect(screen.getByRole('button', { name: 'Teams' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Changes' })).toBeDisabled()
  })
})
