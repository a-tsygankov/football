import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ChipLedgerEntry,
  type ChipLedgerResponse,
  type Gamer,
  GamerId,
  RoomId,
} from '@fc26/shared'
import { SettleUpPanel } from './SettleUpPanel.jsx'

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

function entry(
  gamerId: ReturnType<typeof GamerId>,
  { net = 0, bought = 0, granted = 0, committed = 0 } = {},
): ChipLedgerEntry {
  const purchased = bought + granted
  return {
    gamerId,
    purchased,
    bought,
    granted,
    net,
    committed,
    balance: purchased + net,
    available: purchased + net - committed,
  }
}

function ledgerOf(entries: ReadonlyArray<ChipLedgerEntry>): ChipLedgerResponse {
  // `transfers` is deliberately left empty: the panel settles the room from
  // `entries` itself, so a stale or missing server list must not reach the
  // screen. Filling it with nonsense here is what proves that.
  return { roomId: RoomId('room-1'), entries, transfers: [] }
}

function renderPanel(overrides: Partial<Parameters<typeof SettleUpPanel>[0]> = {}) {
  const props = {
    gamers: [gamer(ann, 'Ann'), gamer(bob, 'Bob'), gamer(cy, 'Cy')],
    ledger: ledgerOf([entry(ann, { bought: 100, net: 50 }), entry(bob, { bought: 100, net: -50 })]),
    liveGame: false,
    ...overrides,
  }
  render(<SettleUpPanel {...props} />)
  return props
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: /close out the room/i }))
}

describe('SettleUpPanel', () => {
  afterEach(cleanup)

  it('stays out of the way until somebody asks to close the room out', () => {
    renderPanel()

    // Settling is an end-of-night action; the ledger above is what people open
    // this page to read.
    expect(screen.queryByText(/bob pays ann/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close out the room/i })).toBeInTheDocument()
  })

  it('says who pays whom', () => {
    renderPanel()
    open()

    const transfers = within(screen.getByRole('list', { name: /settle-up transfers/i }))
    expect(transfers.getByText(/bob pays ann/i)).toBeInTheDocument()
    expect(transfers.getByText('50')).toBeInTheDocument()
  })

  it('shows what each gamer won or lost beyond what they bought', () => {
    renderPanel()
    open()

    const standings = within(screen.getByRole('list', { name: /settle-up standings/i }))
    expect(standings.getByText('Ann')).toBeInTheDocument()
    expect(standings.getByText('+50')).toBeInTheDocument()
    expect(standings.getByText('-50')).toBeInTheDocument()
  })

  it('settles from the ledger rather than trusting the server list', () => {
    renderPanel({
      ledger: {
        roomId: RoomId('room-1'),
        entries: [entry(ann, { bought: 100, net: 60 }), entry(bob, { bought: 100, net: -60 })],
        // A list left over from before the last game settled.
        transfers: [{ from: ann, to: bob, amount: 5 }],
      },
    })
    open()

    expect(screen.getByText(/bob pays ann/i)).toBeInTheDocument()
    expect(screen.queryByText(/ann pays bob/i)).not.toBeInTheDocument()
  })

  it('lists the biggest winner first', () => {
    renderPanel({
      ledger: ledgerOf([
        entry(bob, { bought: 100, net: -70 }),
        entry(ann, { bought: 100, net: 20 }),
        entry(cy, { bought: 100, net: 50 }),
      ]),
    })
    open()

    const names = within(screen.getByRole('list', { name: /settle-up standings/i }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)

    expect(names[0]).toContain('Cy')
    expect(names[2]).toContain('Bob')
  })

  it('leaves out gamers who never took part', () => {
    renderPanel({
      ledger: ledgerOf([
        entry(ann, { bought: 100, net: 50 }),
        entry(bob, { bought: 100, net: -50 }),
        entry(cy, { granted: 200 }),
      ]),
    })
    open()

    const standings = within(screen.getByRole('list', { name: /settle-up standings/i }))
    expect(standings.queryByText('Cy')).not.toBeInTheDocument()
  })

  it('says so plainly when nobody owes anybody', () => {
    renderPanel({
      ledger: ledgerOf([entry(ann, { bought: 100 }), entry(bob, { bought: 100 })]),
    })
    open()

    expect(screen.getByText(/nobody owes anybody/i)).toBeInTheDocument()
  })

  it('warns that stakes still on the table are left out', () => {
    renderPanel({
      ledger: ledgerOf([
        entry(ann, { bought: 100, net: 50, committed: 30 }),
        entry(bob, { bought: 100, net: -50, committed: 20 }),
      ]),
    })
    open()

    // The amount matters as much as the warning: anyone who knows there is 50
    // on the table needs to see the screen knows it too.
    expect(screen.getByText(/50 still riding on unresolved games/i)).toBeInTheDocument()
  })

  it('warns while a game is in progress, even with nothing staked on it', () => {
    renderPanel({ liveGame: true })
    open()

    expect(screen.getByText(/a game is in progress/i)).toBeInTheDocument()
  })

  it('says nothing about open stakes when the room is quiet', () => {
    renderPanel()
    open()

    expect(screen.queryByText(/still riding|unresolved|in progress/i)).not.toBeInTheDocument()
  })

  it('renders before the ledger has loaded', () => {
    renderPanel({ ledger: null })

    expect(screen.getByText(/nobody has bought chips|nothing to settle/i)).toBeInTheDocument()
  })

  it('shares a plain-text summary', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    try {
      renderPanel()
      open()
      fireEvent.click(screen.getByRole('button', { name: /share/i }))

      await waitFor(() => expect(share).toHaveBeenCalled())
      const text = String(share.mock.calls[0]?.[0]?.text ?? '')
      expect(text).toContain('Bob pays Ann 50')
      expect(text).toContain('Ann +50')
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('falls back to the clipboard where sharing is unavailable', async () => {
    Reflect.deleteProperty(navigator, 'share')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    try {
      renderPanel()
      open()
      fireEvent.click(screen.getByRole('button', { name: /share|copy/i }))

      await waitFor(() => expect(writeText).toHaveBeenCalled())
      expect(String(writeText.mock.calls[0]?.[0])).toContain('Bob pays Ann 50')
      // Silent success on a copy looks like a dead button.
      await waitFor(() => expect(screen.getByText(/copied/i)).toBeInTheDocument())
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('closes again', () => {
    renderPanel()
    open()
    fireEvent.click(screen.getByRole('button', { name: /close out the room/i }))

    expect(screen.queryByText(/bob pays ann/i)).not.toBeInTheDocument()
  })
})
