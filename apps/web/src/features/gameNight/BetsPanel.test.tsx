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
    // Bought rather than granted: betting rules only ever read `available`,
    // and a stack you paid for spends the same as one a night handed you.
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

  it('separates what is left from what is already staked', () => {
    renderPanel({ bets: [bet('b1', cy, 'draw', 40)], ledger: [entry(cy, 100, 0, 40)] })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })

    expect(screen.getByText(/100 chips — 60 available/i)).toBeInTheDocument()
  })

  it('refuses a stake bigger than the stack without calling the handler', () => {
    const props = renderPanel({ ledger: [entry(cy, 100, -30)] })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '71' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // The worker refuses this too; catching it here saves a round trip and
    // says whose chips ran out.
    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/cy has 70 chips available/i)).toBeInTheDocument()
  })

  it('measures a top-up against the running total', () => {
    const props = renderPanel({
      bets: [bet('b1', cy, 'draw', 60)],
      ledger: [entry(cy, 100, 0, 60)],
    })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^draw$/i }))
    // 50 is well under the buy-in, but it lands on top of 60.
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/40 chips available on top of the 60/i)).toBeInTheDocument()
  })

  it('refuses a hedge the bettor cannot cover', () => {
    const props = renderPanel({
      bets: [bet('b1', cy, 'draw', 100)],
      ledger: [entry(cy, 100, 0, 100)],
    })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // Covering a second outcome costs a second stake; the first is committed,
    // not freed. Only topping up the same position re-commits chips.
    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/cy is out of chips/i)).toBeInTheDocument()
  })

  it('points a gamer at the Wager page when their balance has gone negative', () => {
    const props = renderPanel({
      // What losing looks like once nights stop handing out chips: nothing
      // bought, and a settled game taken off them.
      ledger: [entry(cy, 0, -20)],
    })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    expect(props.onPlaceBet).not.toHaveBeenCalled()
    expect(screen.getByText(/cy is out of chips — buy some on the wager page/i)).toBeInTheDocument()
  })

  it('measures a top-up against the position on that outcome only', () => {
    const props = renderPanel({
      // Already hedged: 30 on draw and 20 on home, 50 of the stack left.
      bets: [bet('b1', cy, 'draw', 30), bet('b2', cy, 'home', 20)],
      ledger: [entry(cy, 100, 0, 50)],
    })
    fireEvent.change(screen.getByLabelText(/who's betting/i), { target: { value: cy } })
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    fireEvent.change(screen.getByLabelText(/stake/i), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /place bet/i }))

    // The home side becomes 70, which fits: the draw side is untouched and
    // its 30 stays committed.
    expect(props.onPlaceBet).toHaveBeenCalledWith({ gamerId: cy, outcome: 'home', stake: 50 })
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
