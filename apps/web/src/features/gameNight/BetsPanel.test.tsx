import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BetId,
  GameId,
  GameNightId,
  GamerId,
  RoomId,
  type Bet,
  type ChipLedgerEntry,
  type CurrentGame,
  type Gamer,
  DEFAULT_BUY_IN,
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

/**
 * A ledger row as the worker would compute it: `purchased` chips, `net` from
 * settled games, `committed` riding on the open book.
 */
function entry(
  gamerId: ReturnType<typeof GamerId>,
  purchased: number,
  net = 0,
  committed = 0,
): ChipLedgerEntry {
  return {
    gamerId,
    purchased,
    // Bought rather than granted: only the Wager page's own list tells the
    // two apart, and nothing about betting does.
    bought: purchased,
    granted: 0,
    wagered: net,
    settled: 0,
    net,
    committed,
    balance: purchased + net,
    available: purchased + net - committed,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof BetsPanel>[0]> = {}) {
  const props = {
    busy: null,
    currentGame,
    gamers: [gamer(ann, 'Ann'), gamer(bob, 'Bob'), gamer(cy, 'Cy')],
    poolGamerIds: [ann, bob, cy],
    bets: [] as Bet[],
    ledger: [ann, bob, cy].map((id) => entry(id, DEFAULT_BUY_IN)) as ChipLedgerEntry[],
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

  it('renders an empty book instead of crashing when bets is missing', () => {
    // A worker older than the wagering feature answers /bootstrap without
    // `bets`. That reaches us as undefined despite the required prop type,
    // and reducing over it used to throw during render — taking down the
    // whole room screen rather than just this panel. The cast mimics the
    // unvalidated API response that `apiJson` hands us.
    expect(() =>
      renderPanel({ bets: undefined as unknown as Bet[] }),
    ).not.toThrow()

    expect(screen.getByText(/no bets yet/i)).toBeInTheDocument()
    expect(screen.getByText(/pot 0/i)).toBeInTheDocument()
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

  it('shows the selected bettor their stack', () => {
    renderPanel({ ledger: [entry(cy, 100, -30)] })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })

    // 100 bought in, 30 lost so far.
    expect(screen.getByText(/70 chips/i)).toBeInTheDocument()
  })

  it('separates what is held from what is already at risk', () => {
    renderPanel({ bets: [bet('b1', cy, 'draw', 40)], ledger: [entry(cy, 100, 0, 40)] })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })

    // Not "available": nothing here limits the next stake, so a number that
    // reads as an allowance would be a promise the panel does not keep.
    expect(screen.getByText(/100 chips — 40 in play/i)).toBeInTheDocument()
  })

  it('places a stake bigger than the stack', () => {
    const props = renderPanel({ ledger: [entry(cy, 100, -30)] })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // Chips are a tally, not a bankroll: losing this puts Cy deep in debt,
    // which the ledger records and settle-up collects.
    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'draw', stake: 500 })
  })

  it('places an ordinary stake on the first click', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // Just under ten times the buy-in. Asking here would train everyone to
    // tap through the question, which is the failure mode of a warning.
    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'draw', stake: 900 })
  })

  it('asks before placing a stake far larger than the game has seen', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // Nothing is refused — it is asked. The number is spelled out because the
    // mistake being caught is a misread one.
    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/5000 chips is far more than this game has been played for/i))
      .toBeInTheDocument()
  })

  it('places it on the second click', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))
    fireEvent.click(screen.getByRole('button', { name: /place 5000 chips anyway/i }))

    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'draw', stake: 5000 })
  })

  it('asks again when the stake is corrected to another large one', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '50000' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // A confirmation is for one bet, not for a mood.
    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/50000 chips is far more/i)).toBeInTheDocument()
  })

  it('asks again when the same number is aimed at another outcome', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).not.toHaveBeenCalled()
  })

  it('does not ask in a room that plays for that much already', () => {
    const props = renderPanel({ bets: [bet('b1', ann, 'home', 900)] })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // The book itself raises the bar: 5000 next to a 900 is a big bet, not a
    // typo, and a room that plays this way must not be nagged for it.
    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'draw', stake: 5000 })
  })

  it('lets a hedger cover a second outcome with nothing left', () => {
    const props = renderPanel({
      bets: [bet('b1', cy, 'draw', 100)],
      ledger: [entry(cy, 100, 0, 100)],
    })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // Covering a second outcome still costs a second stake — it is just no
    // longer refused for want of one.
    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'home', stake: 40 })
  })

  it('reads a negative balance out as a debt, and still takes the bet', () => {
    const props = renderPanel({
      // Nothing bought, and a settled game taken off them.
      ledger: [entry(cy, 0, -20)],
    })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })

    // "-20 chips" is true and reads like a fault; what it means is a debt.
    expect(screen.getByText(/owes 20 chips/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'home', stake: 5 })
  })

  it('shows every position a hedger holds', () => {
    renderPanel({ bets: [bet('b1', cy, 'draw', 30), bet('b2', cy, 'home', 20)] })

    expect(screen.getByText(/cy — draw — 30/i)).toBeInTheDocument()
    expect(screen.getByText(/cy — home — 20/i)).toBeInTheDocument()
    expect(screen.getByText(/pot 50/i)).toBeInTheDocument()
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
