import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GamerId,
  RoomId,
  type ChipLedgerEntry,
  type ChipLedgerResponse,
  type Gamer,
} from '@fc26/shared'
import { ChipLedgerPanel } from './ChipLedgerPanel.jsx'

const ann = GamerId('ann')
const bob = GamerId('bob')

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

/**
 * A ledger row. `purchased` is treated as chips the gamer bought unless some
 * of it is handed over as `granted`, which is how the old per-night buy-in
 * reaches the ledger — the panel tells the two apart when deciding who to list.
 */
function entry(
  gamerId: ReturnType<typeof GamerId>,
  purchased: number,
  net = 0,
  committed = 0,
  granted = 0,
): ChipLedgerEntry {
  return {
    gamerId,
    purchased,
    bought: purchased - granted,
    granted,
    net,
    committed,
    balance: purchased + net,
    available: purchased + net - committed,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof ChipLedgerPanel>[0]> = {}) {
  const props = {
    busy: null,
    gamers: [gamer(ann, 'Ann'), gamer(bob, 'Bob')],
    ledger: {
      roomId: RoomId('room-1'),
      entries: [entry(ann, 100, 50), entry(bob, 100, -50)],
      transfers: [{ from: bob, to: ann, amount: 50 }],
    } as ChipLedgerResponse,
    onBuyChips: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(<ChipLedgerPanel {...props} />)
  return props
}

describe('ChipLedgerPanel', () => {
  afterEach(cleanup)

  it('shows each balance alongside the profit that produced it', () => {
    renderPanel()

    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('+50')).toBeInTheDocument()
    expect(screen.getByText('-50')).toBeInTheDocument()
  })

  it('leaves out gamers who only ever received a night grant', () => {
    renderPanel({
      gamers: [gamer(ann, 'Ann'), gamer(bob, 'Bob')],
      ledger: {
        roomId: RoomId('room-1'),
        // Bob holds 220 chips he never asked for: the old per-night buy-in
        // issued one to everybody in the pool, wagering or not. Listing him
        // reads as though he played and finished level.
        entries: [entry(ann, 100, 50), entry(bob, 220, 0, 0, 220)],
        transfers: [],
      } as ChipLedgerResponse,
    })

    // Scoped to the balances list: every gamer is also an option in the
    // "who's buying" picker, and being buyable is not the same as being listed.
    const balances = within(screen.getByRole('list', { name: /chip balances/i }))
    expect(balances.getByText('Ann')).toBeInTheDocument()
    expect(balances.queryByText('Bob')).not.toBeInTheDocument()
    expect(balances.queryByText('220')).not.toBeInTheDocument()
  })

  it('keeps a gamer who bought chips but has not bet yet', () => {
    renderPanel({
      ledger: {
        roomId: RoomId('room-1'),
        // Putting money in is taking part, and they need to see it landed.
        entries: [entry(bob, 100)],
        transfers: [],
      } as ChipLedgerResponse,
    })

    const balances = within(screen.getByRole('list', { name: /chip balances/i }))
    expect(balances.getByText('Bob')).toBeInTheDocument()
    expect(balances.getByText('100')).toBeInTheDocument()
  })

  it('leaves settling up to the panel that owns it', () => {
    renderPanel()

    // Two "who pays whom" lists on one page can disagree — this one read the
    // server's precomputed transfers while `SettleUpPanel` derives its own
    // from the balances printed directly above it.
    expect(screen.queryByText(/bob pays ann/i)).not.toBeInTheDocument()
  })

  it('marks chips that are riding on an open game', () => {
    renderPanel({
      ledger: {
        roomId: RoomId('room-1'),
        entries: [entry(ann, 100, 0, 40)],
        transfers: [],
      },
    })

    expect(screen.getByText(/40 in play/i)).toBeInTheDocument()
  })

  it('buys chips for the chosen gamer', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's buying/i), { target: { value: bob } })
    fireEvent.change(screen.getByLabelText(/chips to buy/i), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: /buy chips/i }))

    expect(props.onBuyChips).toHaveBeenCalledWith(bob, 250)
  })

  it('will not buy without a buyer', () => {
    const props = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /buy chips/i }))

    expect(props.onBuyChips).not.toHaveBeenCalled()
    expect(screen.getByText(/pick who is buying/i)).toBeInTheDocument()
  })

  it('will not buy a non-positive amount', () => {
    const props = renderPanel()
    fireEvent.change(screen.getByLabelText(/who's buying/i), { target: { value: bob } })
    fireEvent.change(screen.getByLabelText(/chips to buy/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /buy chips/i }))

    expect(props.onBuyChips).not.toHaveBeenCalled()
    expect(screen.getByText(/buy at least 1 chip/i)).toBeInTheDocument()
  })

  it('renders before the ledger has loaded', () => {
    renderPanel({ ledger: null })

    expect(screen.getByText(/nobody has bought chips/i)).toBeInTheDocument()
  })
})
