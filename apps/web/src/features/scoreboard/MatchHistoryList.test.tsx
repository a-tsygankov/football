import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { MatchHistoryResponse } from '@fc26/shared'
import { MatchHistoryList } from './MatchHistoryList.jsx'

afterEach(() => {
  cleanup()
})

function buildResponse(): MatchHistoryResponse {
  return {
    roomId: 'room-x',
    matches: [
      {
        eventId: 'ev-1',
        gameId: 'game-1',
        gameNightId: 'gn-1',
        occurredAt: 1_700_000_000_000,
        format: '1v1',
        result: 'home',
        // Started without a selected club: clubId is the 0 sentinel but the
        // names recognised at record time are surfaced.
        home: { gamerIds: ['Alice'], gamers: [], clubId: 0, clubName: 'Real Madrid', score: 3, won: true },
        away: { gamerIds: ['Bob'], gamers: [], clubId: 0, clubName: 'Barcelona', score: 0, won: false },
      },
      {
        eventId: 'ev-2',
        gameId: 'game-2',
        gameNightId: 'gn-1',
        occurredAt: 1_700_000_100_000,
        format: '1v1',
        result: 'home',
        // A selected club still resolves to its squad name; the opposite side
        // had neither a selected club nor a recognised name.
        home: { gamerIds: ['Cara'], gamers: [], clubId: 5, clubName: 'Arsenal', score: 2, won: true },
        away: { gamerIds: ['Dan'], gamers: [], clubId: 0, clubName: null, score: 1, won: false },
      },
    ],
  } as unknown as MatchHistoryResponse
}

function buildDrawAndMissingScoreResponse(): MatchHistoryResponse {
  return {
    roomId: 'room-x',
    matches: [
      // A draw with both scores recorded — must render the score (regression
      // guard: draws used to slip through without a visible score).
      {
        eventId: 'ev-draw',
        gameId: 'game-draw',
        gameNightId: 'gn-1',
        occurredAt: 1_700_000_000_000,
        format: '1v1',
        result: 'draw',
        home: { gamerIds: ['Eve'], gamers: [], clubId: 0, clubName: null, score: 2, won: false },
        away: { gamerIds: ['Fred'], gamers: [], clubId: 0, clubName: null, score: 2, won: false },
      },
      // Winner-only / legacy entry without an exact score — shows a clear
      // "Score not recorded" label instead of the old "vs" placeholder.
      {
        eventId: 'ev-noscore',
        gameId: 'game-noscore',
        gameNightId: 'gn-1',
        occurredAt: 1_700_000_100_000,
        format: '1v1',
        result: 'home',
        home: { gamerIds: ['Greg'], gamers: [], clubId: 0, clubName: null, score: null, won: true },
        away: { gamerIds: ['Holly'], gamers: [], clubId: 0, clubName: null, score: null, won: false },
      },
    ],
  } as unknown as MatchHistoryResponse
}

describe('MatchHistoryList', () => {
  it('shows recognised club names and never renders the Club #0 sentinel', async () => {
    const response = buildResponse()
    render(<MatchHistoryList scope={{ type: 'all' }} onLoad={async () => response} />)

    // Recognised names for games started without a selected club.
    await waitFor(() => expect(screen.getByText('Real Madrid')).toBeInTheDocument())
    expect(screen.getByText('Barcelona')).toBeInTheDocument()
    // A selected club resolves to its squad name.
    expect(screen.getByText('Arsenal')).toBeInTheDocument()
    // The "no club selected" sentinel is never shown.
    expect(screen.queryByText(/Club #0/)).toBeNull()
  })

  it('renders draw scores and falls back to "Score not recorded" when absent', async () => {
    const response = buildDrawAndMissingScoreResponse()
    render(<MatchHistoryList scope={{ type: 'all' }} onLoad={async () => response} />)

    // Draw with a real score: score is visible (not "vs", not "Score not recorded").
    await waitFor(() => expect(screen.getByText(/2\s*–\s*2/)).toBeInTheDocument())
    // Legacy/winner-only entry: explicit "Score not recorded" label, never "vs".
    expect(screen.getByText('Score not recorded')).toBeInTheDocument()
    expect(screen.queryByText(/^vs$/)).toBeNull()
  })

  it('colours winners green, losers red, and draws dark slate', async () => {
    const response = buildResponse()
    render(<MatchHistoryList scope={{ type: 'all' }} onLoad={async () => response} />)

    // First match: home wins (Alice green), away loses (Bob red).
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('Alice').style.color).toBe('rgb(21, 128, 61)') // green winner
    expect(screen.getByText('Bob').style.color).toBe('rgb(185, 28, 28)') // red loser

    // Draw scenario from the dedicated builder.
    const drawResp = buildDrawAndMissingScoreResponse()
    cleanup()
    render(<MatchHistoryList scope={{ type: 'all' }} onLoad={async () => drawResp} />)
    await waitFor(() => expect(screen.getByText('Eve')).toBeInTheDocument())
    // Both sides of a draw are dark slate (no green / red contrast).
    expect(screen.getByText('Eve').style.color).toBe('rgb(71, 85, 105)')
    expect(screen.getByText('Fred').style.color).toBe('rgb(71, 85, 105)')
  })
})
