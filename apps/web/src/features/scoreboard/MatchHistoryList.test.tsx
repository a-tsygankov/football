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
})
