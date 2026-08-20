import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type BetHistoryResponse,
  type Gamer,
  GamerId,
  type MoneyEntry,
  RoomId,
} from '@fc26/shared'
import { WagerPage } from './WagerPage.jsx'

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
    avatarUrl: null,
    hasPin: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function renderPage(money: ReadonlyArray<MoneyEntry>, viewerId: ReturnType<typeof GamerId> | null = null) {
  const onLoadHistory = vi.fn().mockResolvedValue({
    roomId: RoomId('room-1'),
    games: [],
    money,
  } satisfies BetHistoryResponse)
  render(
    <WagerPage
      gamers={[gamer(ann, 'Ann'), gamer(bob, 'Bob'), gamer(cy, 'Cyd')]}
      viewerId={viewerId}
      onChangeViewer={vi.fn()}
      onLoadHistory={onLoadHistory}
    />,
  )
  return { onLoadHistory }
}

async function openMoney(): Promise<HTMLElement> {
  const toggle = await screen.findByRole('button', { name: /chip movements?/i })
  fireEvent.click(toggle)
  return toggle
}

describe('WagerPage money history', () => {
  afterEach(cleanup)

  it('stays collapsed until asked, like the bet list above it', async () => {
    renderPage([{ kind: 'purchase', gamerId: ann, amount: 100, occurredAt: 5, reason: 'manual' }])

    expect(await screen.findByRole('button', { name: /show 1 chip movement/i })).toBeInTheDocument()
    expect(screen.queryByText(/bought 100 chips/i)).toBeNull()
  })

  it('names a purchase', async () => {
    renderPage([{ kind: 'purchase', gamerId: ann, amount: 100, occurredAt: 5, reason: 'manual' }])
    await openMoney()

    expect(screen.getByText(/ann bought 100 chips/i)).toBeInTheDocument()
  })

  it('distinguishes a night buy-in from a purchase somebody chose to make', async () => {
    renderPage([
      { kind: 'purchase', gamerId: bob, amount: 100, occurredAt: 5, reason: 'game_night_buy_in' },
    ])
    await openMoney()

    expect(screen.getByText(/bob was bought in for 100/i)).toBeInTheDocument()
  })

  it('writes a two-party settlement as the sentence it is', async () => {
    renderPage([
      {
        kind: 'settlement',
        settlementId: 's1',
        occurredAt: 9,
        paid: [
          { gamerId: ann, amount: 40 },
          { gamerId: cy, amount: -40 },
        ],
      },
    ])
    await openMoney()

    // The payer is named first because that is the direction the cash moved.
    expect(screen.getByText(/cyd paid ann 40/i)).toBeInTheDocument()
  })

  it('reports a multi-party round without inventing who paid whom', async () => {
    renderPage([
      {
        kind: 'settlement',
        settlementId: 's1',
        occurredAt: 9,
        paid: [
          { gamerId: ann, amount: 50 },
          { gamerId: bob, amount: -20 },
          { gamerId: cy, amount: -30 },
        ],
      },
    ])
    await openMoney()

    // Two payers and one payee cannot be written as "X paid Y": the events
    // record each gamer's net change, not the handovers.
    const line = screen.getByText(/settled up/i)
    expect(line).toHaveTextContent('Ann +50')
    expect(line).toHaveTextContent('Bob -20')
    expect(line).toHaveTextContent('Cyd -30')
    // Scoped to the list: the panel subtitle also says "paid".
    expect(within(screen.getByRole('list', { name: /chip movements/i })).queryByText(/ paid /i)).toBeNull()
  })

  it('says so plainly when no chips have moved', async () => {
    renderPage([])

    expect(
      await screen.findByText(/no chips have been bought or paid in this room yet/i),
    ).toBeInTheDocument()
  })

  it('narrows to the chosen gamer, keeping rounds they were part of', async () => {
    renderPage(
      [
        { kind: 'purchase', gamerId: ann, amount: 100, occurredAt: 1, reason: 'manual' },
        { kind: 'purchase', gamerId: bob, amount: 50, occurredAt: 2, reason: 'manual' },
        {
          kind: 'settlement',
          settlementId: 's1',
          occurredAt: 3,
          paid: [
            { gamerId: ann, amount: 40 },
            { gamerId: cy, amount: -40 },
          ],
        },
      ],
      cy,
    )
    const toggle = await openMoney()

    // cy bought nothing, so only the round they paid into survives the filter.
    expect(toggle).toHaveTextContent('1 chip movement')
    const list = within(screen.getByRole('list', { name: /chip movements/i }))
    expect(list.getByText(/cyd paid ann 40/i)).toBeInTheDocument()
    expect(list.queryByText(/bought/i)).toBeNull()
  })
})
