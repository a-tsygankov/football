import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BetId,
  GameId,
  GameNightId,
  GamerId,
  RoomId,
  type Bet,
  type CurrentGame,
  type Gamer,
} from '@fc26/shared'
import { BetsPanel } from './BetsPanel.jsx'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

function gamer(id: ReturnType<typeof GamerId>, name: string): Gamer {
  return {
    id,
    roomId: RoomId('room-1'),
    name,
    rating: 3,
    active: true,
    hasPin: false,
    avatarUrl: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

const currentGame: CurrentGame = {
  id: GameId('game-1'),
  roomId: RoomId('room-1'),
  gameNightId: GameNightId('night-1'),
  status: 'active',
  allocationMode: 'manual',
  format: '1v1',
  homeGamerIds: [ann],
  awayGamerIds: [bob],
  homeClubId: null,
  awayClubId: null,
  selectionStrategyId: 'manual',
  randomSeed: null,
  betsLockedAt: null,
  createdAt: 1,
  updatedAt: 1,
}

function bet(
  id: string,
  gamerId: ReturnType<typeof GamerId>,
  outcome: 'home' | 'away' | 'draw',
  stake: number,
): Bet {
  return {
    id: BetId(id),
    roomId: RoomId('room-1'),
    gameNightId: GameNightId('night-1'),
    gameId: GameId('game-1'),
    gamerId,
    outcome,
    stake,
    createdAt: 1,
    updatedAt: 1,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof BetsPanel>[0]> = {}) {
  const props = {
    busy: null,
    currentGame,
    gamers: [gamer(ann, 'Ann'), gamer(bob, 'Bob'), gamer(cy, 'Cy')],
    poolGamerIds: [ann, bob, cy],
    bets: [] as Bet[],
    onPlaceBet: vi.fn(),
    onRemoveBet: vi.fn(),
    onLockBets: vi.fn(),
    ...overrides,
  }
  render(<BetsPanel {...props} />)
  return props
}

describe('BetsPanel', () => {
  afterEach(cleanup)

  it('shows the pot and each outcome multiplier', () => {
    renderPanel({ bets: [bet('b1', ann, 'home', 50), bet('b2', cy, 'draw', 50)] })

    expect(screen.getByText(/pot 100/i)).toBeInTheDocument()
    // Home has 50 of a 100 pot backing it → pays 2.0x.
    expect(screen.getByText(/home pays 2\.0×/i)).toBeInTheDocument()
  })

  it('shows a dash for an outcome nobody backed', () => {
    renderPanel({ bets: [bet('b1', ann, 'home', 50)] })

    expect(screen.getByText(/away pays —/i)).toBeInTheDocument()
  })

  it('disables outcomes a participant may not back, with a reason', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: ann } })

    expect(screen.getByRole('button', { name: /^draw$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^away$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeEnabled()
    expect(screen.getByText(/you're playing home/i)).toBeInTheDocument()
  })

  it('lets a non-participant back any outcome', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })

    expect(screen.getByRole('button', { name: /^draw$/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^away$/i })).toBeEnabled()
  })

  it('places a bet', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'draw', stake: 25 })
  })

  it('rejects a non-positive stake without calling the handler', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/stake must be at least 1/i)).toBeInTheDocument()
  })

  it('removes a bet', () => {
    const props = renderPanel({ bets: [bet('b1', cy, 'draw', 25)] })
    fireEvent.click(screen.getByRole('button', { name: /remove cy's bet/i }))

    expect(props.onRemoveBet).toHaveBeenCalledWith(BetId('b1'))
  })

  it('renders read-only once the book is locked', () => {
    renderPanel({
      currentGame: { ...currentGame, betsLockedAt: 123 },
      bets: [bet('b1', cy, 'draw', 25)],
    })

    expect(screen.getByText(/bets locked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /place bet/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
})
