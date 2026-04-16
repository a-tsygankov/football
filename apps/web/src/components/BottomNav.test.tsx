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

  it('scrolls to the implemented sections', () => {
    const gameSection = document.createElement('section')
    gameSection.id = 'fc26-game-section'
    gameSection.getBoundingClientRect = vi.fn(() => ({
      top: 96,
      left: 0,
      bottom: 300,
      right: 0,
      width: 0,
      height: 204,
      x: 0,
      y: 96,
      toJSON: () => ({}),
    }))
    document.body.appendChild(gameSection)

    const scoreboardSection = document.createElement('section')
    scoreboardSection.id = 'fc26-scoreboard-section'
    scoreboardSection.getBoundingClientRect = vi.fn(() => ({
      top: 540,
      left: 0,
      bottom: 800,
      right: 0,
      width: 0,
      height: 260,
      x: 0,
      y: 540,
      toJSON: () => ({}),
    }))
    document.body.appendChild(scoreboardSection)

    const teamsSection = document.createElement('section')
    teamsSection.id = 'fc26-teams-section'
    teamsSection.getBoundingClientRect = vi.fn(() => ({
      top: 900,
      left: 0,
      bottom: 1180,
      right: 0,
      width: 0,
      height: 280,
      x: 0,
      y: 900,
      toJSON: () => ({}),
    }))
    document.body.appendChild(teamsSection)

    const changesSection = document.createElement('section')
    changesSection.id = 'fc26-changes-section'
    changesSection.getBoundingClientRect = vi.fn(() => ({
      top: 1280,
      left: 0,
      bottom: 1540,
      right: 0,
      width: 0,
      height: 260,
      x: 0,
      y: 1280,
      toJSON: () => ({}),
    }))
    document.body.appendChild(changesSection)

    render(<BottomNav />)

    fireEvent.click(screen.getByRole('button', { name: 'Game' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    scrollIntoView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    scrollIntoView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    scrollIntoView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('highlights the tab nearest the top of the viewport', () => {
    const gameSection = document.createElement('section')
    gameSection.id = 'fc26-game-section'
    let gameTop = 96
    gameSection.getBoundingClientRect = vi.fn(() => ({
      top: gameTop,
      left: 0,
      bottom: gameTop + 200,
      right: 0,
      width: 0,
      height: 200,
      x: 0,
      y: gameTop,
      toJSON: () => ({}),
    }))
    document.body.appendChild(gameSection)

    const scoreboardSection = document.createElement('section')
    scoreboardSection.id = 'fc26-scoreboard-section'
    let scoreboardTop = 520
    scoreboardSection.getBoundingClientRect = vi.fn(() => ({
      top: scoreboardTop,
      left: 0,
      bottom: scoreboardTop + 220,
      right: 0,
      width: 0,
      height: 220,
      x: 0,
      y: scoreboardTop,
      toJSON: () => ({}),
    }))
    document.body.appendChild(scoreboardSection)

    render(<BottomNav />)
    expect(screen.getByRole('button', { name: 'Game' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Scoreboard' })).not.toHaveAttribute('aria-current')

    gameTop = -260
    scoreboardTop = 104
    fireEvent.scroll(window)

    expect(screen.getByRole('button', { name: 'Scoreboard' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: 'Game' })).not.toHaveAttribute('aria-current')
  })

  it('enables the teams and changes tabs when their sections exist', () => {
    const teamsSection = document.createElement('section')
    teamsSection.id = 'fc26-teams-section'
    teamsSection.getBoundingClientRect = vi.fn(() => ({
      top: 200,
      left: 0,
      bottom: 400,
      right: 0,
      width: 0,
      height: 200,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    }))
    document.body.appendChild(teamsSection)

    const changesSection = document.createElement('section')
    changesSection.id = 'fc26-changes-section'
    changesSection.getBoundingClientRect = vi.fn(() => ({
      top: 500,
      left: 0,
      bottom: 700,
      right: 0,
      width: 0,
      height: 200,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    }))
    document.body.appendChild(changesSection)

    render(<BottomNav />)
    expect(screen.getByRole('button', { name: 'Teams' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Changes' })).toBeEnabled()
  })
})
