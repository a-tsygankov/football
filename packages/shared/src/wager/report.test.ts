import { describe, expect, it } from 'vitest'
import type { PersistedGameEvent } from '../types/events.js'
import { GameNightId, GamerId, RoomId } from '../types/ids.js'
import { ledgerReport, parseEventRows } from './report.js'

const roomId = RoomId('room-1')
const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

const names = new Map([
  [ann, 'Ann'],
  [bob, 'Bob'],
  [cy, 'Cyd'],
])

let seq = 0
function persist(payload: PersistedGameEvent['payload']): PersistedGameEvent {
  seq += 1
  return {
    id: `e${seq}`,
    roomId,
    eventType: payload.type,
    payload,
    schemaVersion: 1,
    correlationId: null,
    occurredAt: seq,
    recordedAt: seq,
  } as PersistedGameEvent
}

function bought(gamerId: typeof ann, amount: number): PersistedGameEvent {
  return persist({
    type: 'chips_purchased',
    schemaVersion: 1,
    roomId,
    gamerId,
    amount,
    gameNightId: GameNightId('n1'),
    occurredAt: seq,
    reason: 'manual',
  } as PersistedGameEvent['payload'])
}

function granted(gamerId: typeof ann, amount: number): PersistedGameEvent {
  return persist({
    type: 'chips_purchased',
    schemaVersion: 1,
    roomId,
    gamerId,
    amount,
    gameNightId: GameNightId('n1'),
    occurredAt: seq,
    reason: 'game_night_buy_in',
  } as PersistedGameEvent['payload'])
}

function played(
  wagers: Array<{ gamerId: typeof ann; stake: number; payout: number }>,
): PersistedGameEvent {
  return persist({
    type: 'game_recorded',
    schemaVersion: 1,
    gameId: `g${seq}`,
    gameNightId: GameNightId('n1'),
    roomId,
    wagers,
  } as unknown as PersistedGameEvent['payload'])
}

function settledUp(gamerId: typeof ann, amount: number): PersistedGameEvent {
  return persist({
    type: 'chips_settled',
    schemaVersion: 1,
    roomId,
    gamerId,
    amount,
    settlementId: 's1',
    occurredAt: seq,
  } as PersistedGameEvent['payload'])
}

/** A sound room: two purchases and a game one of them won. */
function healthy(): PersistedGameEvent[] {
  return [
    bought(ann, 100),
    bought(cy, 100),
    played([
      { gamerId: ann, stake: 20, payout: 50 },
      { gamerId: cy, stake: 30, payout: 0 },
    ]),
  ]
}

describe('parseEventRows', () => {
  it('turns a D1 row into an event, payload and all', () => {
    const [event] = parseEventRows([
      {
        id: 'e1',
        room_id: 'room-1',
        event_type: 'chips_purchased',
        payload: JSON.stringify({ type: 'chips_purchased', gamerId: 'ann', amount: 100 }),
        occurred_at: 7,
      },
    ])

    // Getting this wrong yields a ledger where nobody ever did anything, which
    // reads exactly like a healthy empty room — hence checking the contents.
    expect(event?.payload).toMatchObject({ type: 'chips_purchased', amount: 100 })
    expect(event?.occurredAt).toBe(7)
  })

  it('feeds the fold, rather than producing rows that merely look right', () => {
    const rows = healthy().map((event) => ({
      id: event.id,
      room_id: event.roomId,
      event_type: event.eventType,
      payload: JSON.stringify(event.payload),
      occurred_at: event.occurredAt,
    }))

    const report = ledgerReport({ events: parseEventRows(rows), names })
    expect(report.rows.find((row) => row.name === 'Ann')?.balance).toBe(130)
  })
})

describe('ledgerReport', () => {
  it('says nothing is wrong with a sound room', () => {
    expect(ledgerReport({ events: healthy(), names }).problems).toEqual([])
  })

  it('reports balances richest first, with names attached', () => {
    const report = ledgerReport({ events: healthy(), names })

    expect(report.rows.map((row) => row.name)).toEqual(['Ann', 'Cyd'])
    expect(report.rows[0]?.balance).toBe(130)
    expect(report.rows[1]?.balance).toBe(70)
  })

  it('names who pays whom', () => {
    expect(ledgerReport({ events: healthy(), names }).transfers).toEqual([
      { from: cy, to: ann, amount: 30 },
    ])
  })

  it('leaves out anybody who never took part', () => {
    const report = ledgerReport({ events: healthy(), names })

    expect(report.rows.some((row) => row.name === 'Bob')).toBe(false)
  })

  it('catches wagering that does not cancel', () => {
    // A payout with no matching loss: settlement invented 10 chips.
    const report = ledgerReport({
      events: [bought(ann, 100), played([{ gamerId: ann, stake: 20, payout: 30 }])],
      names,
    })

    expect(report.problems).toHaveLength(1)
    expect(report.problems[0]).toMatch(/lifetime results sum to 10/i)
  })

  it('catches a settlement that credited without debiting', () => {
    const report = ledgerReport({
      events: [...healthy(), settledUp(ann, 30)],
      names,
    })

    expect(report.problems.some((p) => /settlements do not cancel: they sum to 30/i.test(p))).toBe(
      true,
    )
  })

  it('catches a night still handing out chips', () => {
    const report = ledgerReport({ events: [...healthy(), granted(bob, 100)], names })

    expect(report.problems.some((p) => /still hold granted chips: Bob 100/i.test(p))).toBe(true)
  })

  it('catches a ledger row that names nobody on the roster', () => {
    const ghost = GamerId('ghost')
    const report = ledgerReport({
      events: [
        ...healthy(),
        played([
          { gamerId: ghost, stake: 10, payout: 20 },
          { gamerId: ann, stake: 10, payout: 0 },
        ]),
      ],
      names,
    })

    // The chips are real and there is nobody to hand them to.
    expect(report.problems.some((p) => /name no gamer: ghost/i.test(p))).toBe(true)
  })

  it('reports every problem at once rather than the first', () => {
    const report = ledgerReport({
      events: [
        bought(ann, 100),
        granted(bob, 50),
        played([{ gamerId: ann, stake: 20, payout: 30 }]),
        settledUp(cy, 5),
      ],
      names,
    })

    // Being told about one fault, fixing it, and being told about the next is
    // a worse morning than being told about all of them.
    expect(report.problems.length).toBeGreaterThanOrEqual(3)
  })

  it('counts open stakes as committed, so available matches the app', () => {
    const report = ledgerReport({
      events: healthy(),
      names,
      openBets: [{ gamerId: ann, stake: 40 }],
    })
    const annRow = report.rows.find((row) => row.name === 'Ann')

    expect(annRow?.committed).toBe(40)
    expect(annRow?.available).toBe(90)
  })
})
