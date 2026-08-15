import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function entry(
  gamerId: ReturnType<typeof GamerId>,
  purchased: number,
  net = 0,
  committed = 0,
): ChipLedgerEntry {
  return {
    gamerId,
    purchased,
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

  it('says who pays whom', () => {
    renderPanel()

    expect(screen.getByText(/bob pays ann/i)).toBeInTheDocument()
  })

  it('says there is nothing to settle when everyone is level', () => {
    renderPanel({
      ledger: {
        roomId: RoomId('room-1'),
        entries: [entry(ann, 100), entry(bob, 100)],
        transfers: [],
      },
    })

    // Buying chips is not a debt to anyone in the room; only play creates one.
    expect(screen.getByText(/nobody owes anybody/i)).toBeInTheDocument()
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
