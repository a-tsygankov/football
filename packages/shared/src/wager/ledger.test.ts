import { describe, expect, it } from 'vitest'
import type {
  ChipsPurchasedEvent,
  ChipsSettledEvent,
  GameRecordedEvent,
  GameVoidedEvent,
  PersistedGameEvent,
} from '../types/events.js'
import { EventId, GameId, GameNightId, GamerId, RoomId } from '../types/ids.js'
import {
  hasChipActivity,
  settlementAmounts,
  settlementForPayment,
  ledgerEntryFor,
  maxStakeOnGame,
  roomChipLedger,
  settleUp,
} from './ledger.js'

const roomId = RoomId('room-1')
const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

let seq = 0
function persist(payload: PersistedGameEvent['payload']): PersistedGameEvent {
  seq += 1
  return {
    id: EventId(`e${seq}`),
    roomId,
    eventType: payload.type,
    payload,
    schemaVersion: 1,
    correlationId: null,
    occurredAt: seq,
    recordedAt: seq,
  }
}

function granted(gamerId: typeof ann, amount: number, night = 'night-1'): PersistedGameEvent {
  return persist({
    type: 'chips_purchased',
    schemaVersion: 1,
    roomId,
    gamerId,
    amount,
    gameNightId: GameNightId(night),
    occurredAt: seq,
    reason: 'game_night_buy_in',
  } satisfies ChipsPurchasedEvent)
}

/** Chips somebody chose to buy, as opposed to a night handing them over. */
function bought(gamerId: typeof ann, amount: number, night = 'night-1'): PersistedGameEvent {
  return persist({
    type: 'chips_purchased',
    schemaVersion: 1,
    roomId,
    gamerId,
    amount,
    gameNightId: GameNightId(night),
    occurredAt: seq,
    reason: 'manual',
  } satisfies ChipsPurchasedEvent)
}

/** A debt squared up in cash, cancelling that gamer's outstanding position. */
function settledUp(gamerId: typeof ann, amount: number, id = 's1'): PersistedGameEvent {
  return persist({
    type: 'chips_settled',
    schemaVersion: 1,
    roomId,
    gamerId,
    amount,
    settlementId: id,
    occurredAt: seq,
  } satisfies ChipsSettledEvent)
}

/** A settled game whose wagers move chips between the named gamers. */
function settled(
  gameId: string,
  wagers: Array<{ gamerId: typeof ann; stake: number; payout: number }>,
  night = 'night-1',
): PersistedGameEvent {
  return persist({
    type: 'game_recorded',
    schemaVersion: 1,
    gameId: GameId(gameId),
    gameNightId: GameNightId(night),
    roomId,
    format: '1v1',
    size: 2,
    occurredAt: seq,
    home: { gamerIds: [ann], gamerTeamKey: 'ann', clubId: 0, score: 1 },
    away: { gamerIds: [bob], gamerTeamKey: 'bob', clubId: 0, score: 0 },
    result: 'home',
    squadVersion: 'v1',
    selectionStrategyId: 'manual',
    entryMethod: 'manual',
    wagers: wagers.map((w) => ({ ...w, outcome: 'home' as const })),
  } satisfies GameRecordedEvent)
}

describe('roomChipLedger', () => {
  it('counts purchases as the only way chips enter', () => {
    const ledger = roomChipLedger([granted(ann, 100), granted(ann, 50)])

    expect(ledger.get(ann)!.purchased).toBe(150)
    expect(ledger.get(ann)!.balance).toBe(150)
    expect(ledger.get(ann)!.net).toBe(0)
  })

  it('carries balances across nights', () => {
    const ledger = roomChipLedger([
      granted(ann, 100, 'night-1'),
      granted(bob, 100, 'night-1'),
      settled('g1', [
        { gamerId: ann, stake: 50, payout: 100 },
        { gamerId: bob, stake: 50, payout: 0 },
      ]),
      // A second night with no fresh purchases: whatever they held stands.
      settled(
        'g2',
        [
          { gamerId: ann, stake: 20, payout: 0 },
          { gamerId: bob, stake: 20, payout: 40 },
        ],
        'night-2',
      ),
    ])

    // Ann: +50 then −20. Bob: −50 then +20. Nothing reset at the boundary.
    expect(ledger.get(ann)!.balance).toBe(130)
    expect(ledger.get(bob)!.balance).toBe(70)
  })

  it('excludes a voided game from the ledger', () => {
    const events = [
      granted(ann, 100),
      granted(bob, 100),
      settled('g1', [
        { gamerId: ann, stake: 50, payout: 100 },
        { gamerId: bob, stake: 50, payout: 0 },
      ]),
    ]
    const voided = persist({
      type: 'game_voided',
      schemaVersion: 1,
      gameId: GameId('g1'),
      gameNightId: GameNightId('night-1'),
      roomId,
      occurredAt: seq,
      reason: 'mistake',
    } satisfies GameVoidedEvent)

    const ledger = roomChipLedger([...events, voided])

    // Deleting the game un-does its wagers by simply not folding them in —
    // which is why voiding needs no wager-specific rollback.
    expect(ledger.get(ann)!.balance).toBe(100)
    expect(ledger.get(bob)!.balance).toBe(100)
  })

  it('holds open stakes out of what can be bet again', () => {
    const ledger = roomChipLedger([granted(ann, 100)], [{ gamerId: ann, stake: 30 }])

    expect(ledger.get(ann)!.committed).toBe(30)
    expect(ledger.get(ann)!.balance).toBe(100)
    expect(ledger.get(ann)!.available).toBe(70)
  })

  it('gives a gamer with no history an empty standing', () => {
    const ledger = roomChipLedger([granted(ann, 100)])

    const missing = ledgerEntryFor(ledger, cy)
    expect(missing.balance).toBe(0)
    expect(missing.available).toBe(0)
  })
})

describe('maxStakeOnGame', () => {
  it('lets an existing position be re-committed rather than double-counted', () => {
    const ledger = roomChipLedger([granted(ann, 100)], [{ gamerId: ann, stake: 100 }])
    const entry = ledger.get(ann)!

    expect(entry.available).toBe(0)
    expect(maxStakeOnGame(entry, 100)).toBe(100)
  })

  it('does not free up chips riding on a different game', () => {
    const ledger = roomChipLedger(
      [granted(ann, 100)],
      [
        { gamerId: ann, stake: 40 },
        { gamerId: ann, stake: 30 },
      ],
    )

    expect(maxStakeOnGame(ledger.get(ann)!, 40)).toBe(70)
  })
})

describe('settleUp', () => {
  it('pays every winner out of the losers', () => {
    const ledger = roomChipLedger([
      granted(ann, 100),
      granted(bob, 100),
      settled('g1', [
        { gamerId: ann, stake: 50, payout: 100 },
        { gamerId: bob, stake: 50, payout: 0 },
      ]),
    ])

    expect(settleUp(ledger.values())).toEqual([{ from: bob, to: ann, amount: 50 }])
  })

  it('settles three people in two payments, not four', () => {
    // Ann +60, Bob −40, Cy −20. Naively every loser pays every winner; here
    // one transfer per debtor closes it.
    const ledger = roomChipLedger([
      settled('g1', [
        { gamerId: ann, stake: 40, payout: 100 },
        { gamerId: bob, stake: 40, payout: 0 },
        { gamerId: cy, stake: 20, payout: 0 },
      ]),
    ])

    const transfers = settleUp(ledger.values())
    expect(transfers).toEqual([
      { from: bob, to: ann, amount: 40 },
      { from: cy, to: ann, amount: 20 },
    ])
    expect(transfers.length).toBeLessThanOrEqual(2)
  })

  it('balances to zero, so nobody is left owing into thin air', () => {
    const ledger = roomChipLedger([
      settled('g1', [
        { gamerId: ann, stake: 30, payout: 90 },
        { gamerId: bob, stake: 30, payout: 0 },
        { gamerId: cy, stake: 30, payout: 0 },
      ]),
    ])

    const transfers = settleUp(ledger.values())
    const paid = new Map<string, number>()
    for (const t of transfers) {
      paid.set(t.from, (paid.get(t.from) ?? 0) - t.amount)
      paid.set(t.to, (paid.get(t.to) ?? 0) + t.amount)
    }
    for (const item of ledger.values()) {
      expect(paid.get(item.gamerId) ?? 0).toBe(item.net)
    }
  })

  it('keeps bought chips apart from the ones a night granted', () => {
    const ledger = roomChipLedger([granted(ann, 100), bought(ann, 40)])

    const entry = ledgerEntryFor(ledger, ann)
    expect(entry.granted).toBe(100)
    expect(entry.bought).toBe(40)
    // The split is bookkeeping; what they hold is unchanged by it.
    expect(entry.purchased).toBe(140)
    expect(entry.balance).toBe(140)
  })

  it('counts a gamer who only ever received a night grant as inactive', () => {
    const ledger = roomChipLedger([granted(ann, 100)])

    // The old per-night buy-in issued one of these to everybody in the pool,
    // so holding one says nothing about whether they took part.
    expect(hasChipActivity(ledgerEntryFor(ledger, ann))).toBe(false)
  })

  it('counts buying chips as taking part, even before the first bet', () => {
    const ledger = roomChipLedger([bought(ann, 100)])

    expect(hasChipActivity(ledgerEntryFor(ledger, ann))).toBe(true)
  })

  it('counts a grant-only gamer as active once they win, lose or have a stake down', () => {
    const wagered = roomChipLedger([
      granted(ann, 100),
      granted(bob, 100),
      settled('g1', [
        { gamerId: ann, stake: 20, payout: 40 },
        { gamerId: bob, stake: 20, payout: 0 },
      ]),
    ])
    expect(hasChipActivity(ledgerEntryFor(wagered, ann))).toBe(true)
    expect(hasChipActivity(ledgerEntryFor(wagered, bob))).toBe(true)

    const riding = roomChipLedger([granted(cy, 100)], [{ gamerId: cy, stake: 10 }])
    expect(hasChipActivity(ledgerEntryFor(riding, cy))).toBe(true)
  })


  it('leaves nobody owing anything once the room has settled up', () => {
    const events = [
      bought(ann, 100),
      bought(bob, 100),
      settled('g1', [
        { gamerId: ann, stake: 20, payout: 50 },
        { gamerId: bob, stake: 30, payout: 0 },
      ]),
    ]
    const before = roomChipLedger(events)
    expect(ledgerEntryFor(before, ann).net).toBe(30)
    expect(ledgerEntryFor(before, bob).net).toBe(-30)

    const after = roomChipLedger([...events, settledUp(ann, 30), settledUp(bob, -30)])

    // Paid in cash, so the debt is gone and the chips they bought remain.
    expect(ledgerEntryFor(after, ann).net).toBe(0)
    expect(ledgerEntryFor(after, bob).net).toBe(0)
    expect(ledgerEntryFor(after, ann).balance).toBe(100)
    expect(ledgerEntryFor(after, bob).balance).toBe(100)
    expect(settleUp(after.values())).toEqual([])
  })

  it('keeps the lifetime result after settling, because it is a different question', () => {
    const after = roomChipLedger([
      bought(ann, 100),
      bought(bob, 100),
      settled('g1', [
        { gamerId: ann, stake: 20, payout: 50 },
        { gamerId: bob, stake: 30, payout: 0 },
      ]),
      settledUp(ann, 30),
      settledUp(bob, -30),
    ])

    // Ann is still up 30 all-time; she has simply been paid it.
    expect(ledgerEntryFor(after, ann).wagered).toBe(30)
    expect(ledgerEntryFor(after, ann).settled).toBe(30)
    expect(ledgerEntryFor(after, bob).wagered).toBe(-30)
  })

  it('counts only what has happened since the last settle-up', () => {
    const events = [
      bought(ann, 100),
      bought(bob, 100),
      settled('g1', [
        { gamerId: ann, stake: 20, payout: 50 },
        { gamerId: bob, stake: 30, payout: 0 },
      ]),
      settledUp(ann, 30),
      settledUp(bob, -30),
      settled('g2', [
        { gamerId: ann, stake: 10, payout: 0 },
        { gamerId: bob, stake: 5, payout: 15 },
      ]),
    ]
    const after = roomChipLedger(events)

    // The second night stands on its own: ann owes 10, bob is owed 10.
    expect(ledgerEntryFor(after, ann).net).toBe(-10)
    expect(ledgerEntryFor(after, bob).net).toBe(10)
    expect(settleUp(after.values())).toEqual([{ from: ann, to: bob, amount: 10 }])
  })

  it('names the amount each gamer must settle for, and skips the square', () => {
    const ledger = roomChipLedger([
      bought(cy, 100),
      settled('g1', [
        { gamerId: ann, stake: 20, payout: 50 },
        { gamerId: bob, stake: 30, payout: 0 },
      ]),
    ])

    const amounts = settlementAmounts(ledger.values())
    expect(amounts).toEqual([
      { gamerId: ann, amount: 30 },
      { gamerId: bob, amount: -30 },
    ])
    // Folding them back in must leave the room square — that is the whole job.
    expect(amounts.reduce((sum, a) => sum + a.amount, 0)).toBe(0)
    expect(amounts.some((a) => a.gamerId === cy)).toBe(false)
  })


  describe('settling one payment at a time', () => {
    /** cy is down 30 to ann, and bob is square. */
    function owing() {
      return roomChipLedger([
        bought(ann, 100),
        bought(cy, 100),
        settled('g1', [
          { gamerId: ann, stake: 20, payout: 50 },
          { gamerId: cy, stake: 30, payout: 0 },
        ]),
      ])
    }

    it('records a payment as two amounts that cancel', () => {
      expect(settlementForPayment(owing(), cy, ann, 30)).toEqual([
        { gamerId: ann, amount: 30 },
        { gamerId: cy, amount: -30 },
      ])
    })

    it('leaves the payer and payee square, and nobody else touched', () => {
      const paid = settlementForPayment(owing(), cy, ann, 30)!
      const after = roomChipLedger([
        bought(ann, 100),
        bought(cy, 100),
        settled('g1', [
          { gamerId: ann, stake: 20, payout: 50 },
          { gamerId: cy, stake: 30, payout: 0 },
        ]),
        ...paid.map((entry) => settledUp(entry.gamerId, entry.amount)),
      ])

      expect(ledgerEntryFor(after, ann).net).toBe(0)
      expect(ledgerEntryFor(after, cy).net).toBe(0)
      expect(settleUp(after.values())).toEqual([])
    })

    it('takes a part payment, because people pay what cash they have', () => {
      const part = settlementForPayment(owing(), cy, ann, 10)
      expect(part).toEqual([
        { gamerId: ann, amount: 10 },
        { gamerId: cy, amount: -10 },
      ])

      const after = roomChipLedger([
        bought(ann, 100),
        bought(cy, 100),
        settled('g1', [
          { gamerId: ann, stake: 20, payout: 50 },
          { gamerId: cy, stake: 30, payout: 0 },
        ]),
        ...part!.map((entry) => settledUp(entry.gamerId, entry.amount)),
      ])

      // 20 of the 30 is still outstanding, and still points the same way.
      expect(ledgerEntryFor(after, ann).net).toBe(20)
      expect(ledgerEntryFor(after, cy).net).toBe(-20)
      expect(settleUp(after.values())).toEqual([{ from: cy, to: ann, amount: 20 }])
    })

    it('refuses to pay more than is owed', () => {
      expect(settlementForPayment(owing(), cy, ann, 31)).toBeNull()
    })

    it('refuses a payment to somebody who is not owed anything', () => {
      expect(settlementForPayment(owing(), cy, bob, 10)).toBeNull()
    })

    it('refuses a payment from somebody who owes nothing', () => {
      // bob is square, so this would invent a debt in both directions.
      expect(settlementForPayment(owing(), bob, ann, 10)).toBeNull()
    })

    it('refuses the wrong direction — the creditor does not pay the debtor', () => {
      expect(settlementForPayment(owing(), ann, cy, 30)).toBeNull()
    })

    it('refuses a payment between two people who are both owed money', () => {
      // ann +30, bob +20, cy -50. Neither creditor owes the other anything, so
      // a payment between them would invent a debt in both directions. The
      // check on the payer's side is what catches this — the payee's side
      // cannot, because being owed is exactly what makes them a valid payee.
      const twoCreditors = roomChipLedger([
        settled('g1', [
          { gamerId: ann, stake: 20, payout: 50 },
          { gamerId: bob, stake: 10, payout: 30 },
          { gamerId: cy, stake: 50, payout: 0 },
        ]),
      ])
      expect(ledgerEntryFor(twoCreditors, ann).net).toBe(30)
      expect(ledgerEntryFor(twoCreditors, bob).net).toBe(20)

      expect(settlementForPayment(twoCreditors, ann, bob, 10)).toBeNull()
      expect(settlementForPayment(twoCreditors, bob, ann, 10)).toBeNull()
    })

    it('refuses nonsense amounts', () => {
      const ledger = owing()
      expect(settlementForPayment(ledger, cy, ann, 0)).toBeNull()
      expect(settlementForPayment(ledger, cy, ann, -10)).toBeNull()
      expect(settlementForPayment(ledger, cy, ann, 1.5)).toBeNull()
      expect(settlementForPayment(ledger, cy, cy, 10)).toBeNull()
    })
  })

  it('has nothing to settle when nobody is up or down', () => {
    const ledger = roomChipLedger([granted(ann, 100), granted(bob, 100)])

    // Buying chips is not a debt to anyone in the room; only play creates one.
    expect(settleUp(ledger.values())).toEqual([])
  })

  it('ignores open stakes, which are neither won nor lost yet', () => {
    const ledger = roomChipLedger([granted(ann, 100)], [{ gamerId: ann, stake: 60 }])

    expect(settleUp(ledger.values())).toEqual([])
  })
})
