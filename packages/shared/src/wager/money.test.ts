import { describe, expect, it } from 'vitest'
import type {
  ChipsPurchasedEvent,
  ChipsSettledEvent,
  PersistedGameEvent,
} from '../types/events.js'
import { EventId, GameNightId, GamerId, RoomId } from '../types/ids.js'
import { filterMoneyHistory, involvesGamer, moneyHistory } from './money.js'

const roomId = RoomId('room-1')
const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

let seq = 0
function persist(payload: PersistedGameEvent['payload'], at = ++seq): PersistedGameEvent {
  return {
    id: EventId(`e${seq}`),
    roomId,
    eventType: payload.type,
    payload,
    schemaVersion: 1,
    correlationId: null,
    occurredAt: at,
    recordedAt: at,
  }
}

function bought(gamerId: typeof ann, amount: number, at?: number): PersistedGameEvent {
  return persist(
    {
      type: 'chips_purchased',
      schemaVersion: 1,
      roomId,
      gamerId,
      amount,
      gameNightId: GameNightId('night-1'),
      occurredAt: at ?? seq + 1,
      reason: 'manual',
    } satisfies ChipsPurchasedEvent,
    at,
  )
}

function settledUp(
  gamerId: typeof ann,
  amount: number,
  settlementId: string,
  at?: number,
): PersistedGameEvent {
  return persist(
    {
      type: 'chips_settled',
      schemaVersion: 1,
      roomId,
      gamerId,
      amount,
      settlementId,
      occurredAt: at ?? seq + 1,
    } satisfies ChipsSettledEvent,
    at,
  )
}

describe('moneyHistory', () => {
  it('reports a purchase', () => {
    expect(moneyHistory([bought(ann, 100, 5)])).toEqual([
      { kind: 'purchase', gamerId: ann, amount: 100, occurredAt: 5, reason: 'manual' },
    ])
  })

  it('groups one settlement into a single entry naming both sides', () => {
    // Two events, one payment: without the grouping this reads as two
    // unrelated things happening in the same millisecond.
    const history = moneyHistory([settledUp(ann, 40, 's1', 9), settledUp(cy, -40, 's1', 9)])

    expect(history).toEqual([
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
  })

  it('keeps separate settlement rounds apart', () => {
    const history = moneyHistory([
      settledUp(ann, 40, 's1', 9),
      settledUp(cy, -40, 's1', 9),
      settledUp(ann, 10, 's2', 12),
      settledUp(bob, -10, 's2', 12),
    ])

    expect(history).toHaveLength(2)
    expect(history.map((e) => e.kind === 'settlement' && e.settlementId)).toEqual(['s2', 's1'])
  })

  it('reports a whole-room round as the round it was', () => {
    // The events record each gamer's net change, not who handed cash to whom.
    // Three gamers in one round is reported as three, rather than guessing at
    // pairings the room never recorded.
    const history = moneyHistory([
      settledUp(ann, 50, 's1', 3),
      settledUp(bob, -20, 's1', 3),
      settledUp(cy, -30, 's1', 3),
    ])

    expect(history).toHaveLength(1)
    const round = history[0]
    expect(round.kind).toBe('settlement')
    if (round.kind !== 'settlement') throw new Error('expected a settlement')
    expect(round.paid).toHaveLength(3)
    // The round must cancel, or the ledger would not.
    expect(round.paid.reduce((sum, p) => sum + p.amount, 0)).toBe(0)
  })

  it('puts the newest first', () => {
    const history = moneyHistory([
      bought(ann, 100, 1),
      settledUp(ann, 40, 's1', 7),
      settledUp(cy, -40, 's1', 7),
      bought(bob, 50, 4),
    ])

    expect(history.map((e) => e.occurredAt)).toEqual([7, 4, 1])
  })

  it('ignores bets and games, which the bet history already covers', () => {
    const events = [
      bought(ann, 100, 1),
      persist({
        type: 'game_recorded',
        schemaVersion: 1,
        gameId: 'g1',
        gameNightId: GameNightId('night-1'),
        roomId,
        format: '1v1',
        size: 1,
        occurredAt: 2,
        home: { gamerIds: [ann], club: null },
        away: { gamerIds: [bob], club: null },
        result: 'home',
        squadVersion: 'v1',
        selectionStrategyId: 'manual',
        entryMethod: 'manual',
      } as unknown as PersistedGameEvent['payload']),
    ]

    expect(moneyHistory(events)).toHaveLength(1)
  })

  it('is empty for a room where no chips have moved', () => {
    expect(moneyHistory([])).toEqual([])
  })
})

describe('filterMoneyHistory', () => {
  const history = moneyHistory([
    bought(ann, 100, 1),
    bought(bob, 50, 2),
    settledUp(ann, 40, 's1', 3),
    settledUp(cy, -40, 's1', 3),
  ])

  it('returns everything when nobody is named', () => {
    expect(filterMoneyHistory(history, null)).toHaveLength(3)
  })

  it('keeps a gamer their own purchases and any round they were part of', () => {
    const forAnn = filterMoneyHistory(history, ann)

    expect(forAnn).toHaveLength(2)
    expect(forAnn.some((e) => e.kind === 'purchase' && e.gamerId === ann)).toBe(true)
    expect(forAnn.some((e) => e.kind === 'settlement')).toBe(true)
  })

  it('keeps the payer their round even though they only appear on its losing side', () => {
    const forCy = filterMoneyHistory(history, cy)

    expect(forCy).toHaveLength(1)
    expect(forCy[0]?.kind).toBe('settlement')
  })

  it('gives somebody uninvolved nothing', () => {
    expect(filterMoneyHistory(history, GamerId('nobody'))).toEqual([])
  })

  it('answers the same question as involvesGamer', () => {
    for (const entry of history) {
      expect(involvesGamer(entry, ann)).toBe(filterMoneyHistory([entry], ann).length === 1)
    }
  })
})
