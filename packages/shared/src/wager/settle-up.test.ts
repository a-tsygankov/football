import { describe, expect, it } from 'vitest'
import { GamerId } from '../types/ids.js'
import type { ChipLedgerEntry } from './ledger.js'
import { roomSettlement, settlementText } from './settle-up.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')
const dee = GamerId('dee')

/**
 * A ledger row, built directly rather than folded from events.
 *
 * The fold is `roomChipLedger`'s business and is tested there; what matters
 * here is only what settling does with the numbers it produces.
 */
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

/** Every gamer ends up exactly level once the transfers are paid. */
function clearsEveryNet(entries: ReadonlyArray<ChipLedgerEntry>): void {
  const { transfers } = roomSettlement(entries)
  const moved = new Map<string, number>()
  for (const transfer of transfers) {
    moved.set(transfer.from, (moved.get(transfer.from) ?? 0) - transfer.amount)
    moved.set(transfer.to, (moved.get(transfer.to) ?? 0) + transfer.amount)
  }
  for (const item of entries) {
    expect(moved.get(item.gamerId) ?? 0).toBe(item.net)
  }
}

describe('roomSettlement', () => {
  it('reports what each gamer won or lost beyond what they bought', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 50 }),
      entry(bob, { bought: 100, net: -50 }),
    ])

    // The net is the whole claim: buying chips is not a debt to anyone in the
    // room, so a gamer who bought 500 and finished level owes nothing.
    expect(settlement.standings).toEqual([
      { gamerId: ann, net: 50 },
      { gamerId: bob, net: -50 },
    ])
  })

  it('lists the biggest winner first and the biggest loser last', () => {
    const settlement = roomSettlement([
      entry(bob, { bought: 100, net: -70 }),
      entry(ann, { bought: 100, net: 20 }),
      entry(cy, { bought: 100, net: 50 }),
    ])

    expect(settlement.standings.map((item) => item.gamerId)).toEqual([cy, ann, bob])
  })

  it('breaks a tie on equal net by the lower gamer id', () => {
    // Same convention as settleWagers uses for leftover chips: the larger
    // amount first, then the lower id. Two phones holding the same ledger must
    // print the same list, whatever order their entries arrived in.
    const settlement = roomSettlement([
      entry(cy, { bought: 100, net: 30 }),
      entry(ann, { bought: 100, net: 30 }),
      entry(bob, { bought: 100, net: -60 }),
    ])

    expect(settlement.standings.map((item) => item.gamerId)).toEqual([ann, cy, bob])
  })

  it('gives the same answer whatever order the entries arrive in', () => {
    const entries = [
      entry(ann, { bought: 100, net: 40 }),
      entry(bob, { bought: 100, net: -25 }),
      entry(cy, { bought: 100, net: 40 }),
      entry(dee, { bought: 100, net: -55 }),
    ]

    const forwards = roomSettlement(entries)
    const backwards = roomSettlement([...entries].reverse())

    expect(backwards.standings).toEqual(forwards.standings)
    expect(backwards.transfers).toEqual(forwards.transfers)
  })

  it('leaves out gamers who never took part', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 50 }),
      entry(bob, { bought: 100, net: -50 }),
      // The old per-night buy-in issued one of these to everybody in the pool.
      // Holding one says nothing about whether they played, and listing them
      // at zero reads as though they did and finished level.
      entry(cy, { granted: 200 }),
    ])

    expect(settlement.standings.map((item) => item.gamerId)).toEqual([ann, bob])
  })

  it('keeps everyone who took part, even those who finished level', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 0 }),
      entry(bob, { bought: 100, net: 0 }),
    ])

    // Nothing to pay, but they are still the room: an empty screen would look
    // like the ledger failed to load rather than like a night that came out level.
    expect(settlement.standings).toEqual([
      { gamerId: ann, net: 0 },
      { gamerId: bob, net: 0 },
    ])
    expect(settlement.transfers).toEqual([])
  })

  it('has nothing to settle when everyone is even', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100 }),
      entry(bob, { bought: 250 }),
    ])

    expect(settlement.transfers).toEqual([])
  })

  it('pays one winner out of several losers', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 60 }),
      entry(bob, { bought: 100, net: -40 }),
      entry(cy, { bought: 100, net: -20 }),
    ])

    expect(settlement.transfers).toEqual([
      { from: bob, to: ann, amount: 40 },
      { from: cy, to: ann, amount: 20 },
    ])
  })

  it('splits one loser across several winners', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: -90 }),
      entry(bob, { bought: 100, net: 60 }),
      entry(cy, { bought: 100, net: 30 }),
    ])

    // Largest credit first, so the biggest obligation is cleared by the
    // fewest payments.
    expect(settlement.transfers).toEqual([
      { from: ann, to: bob, amount: 60 },
      { from: ann, to: cy, amount: 30 },
    ])
  })

  it('closes the room in at most one payment fewer than there are gamers', () => {
    const entries = [
      entry(ann, { bought: 100, net: 75 }),
      entry(bob, { bought: 100, net: 25 }),
      entry(cy, { bought: 100, net: -40 }),
      entry(dee, { bought: 100, net: -60 }),
    ]

    // The point of settling greedily rather than having each loser pay each
    // winner, which would be four payments here.
    expect(roomSettlement(entries).transfers.length).toBeLessThanOrEqual(entries.length - 1)
  })

  it('excludes stakes still riding on unresolved games', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 50, committed: 30 }),
      entry(bob, { bought: 100, net: -50, committed: 20 }),
    ])

    // An unresolved bet is neither won nor lost, so it moves no money — but
    // the screen has to say so, or the numbers look wrong to anyone who knows
    // there is 50 on the table.
    expect(settlement.openStakes).toBe(50)
    expect(settlement.transfers).toEqual([{ from: bob, to: ann, amount: 50 }])
  })

  it('reports no open stakes when nothing is riding', () => {
    const settlement = roomSettlement([entry(ann, { bought: 100, net: 50 })])

    expect(settlement.openStakes).toBe(0)
  })

  it('settles an empty room without complaint', () => {
    const settlement = roomSettlement([])

    expect(settlement.standings).toEqual([])
    expect(settlement.transfers).toEqual([])
    expect(settlement.openStakes).toBe(0)
  })

  describe('transfers clear every net exactly', () => {
    it('for a simple two-way split', () => {
      clearsEveryNet([
        entry(ann, { bought: 100, net: 50 }),
        entry(bob, { bought: 100, net: -50 }),
      ])
    })

    it('for one winner against many losers', () => {
      clearsEveryNet([
        entry(ann, { bought: 100, net: 120 }),
        entry(bob, { bought: 100, net: -40 }),
        entry(cy, { bought: 100, net: -50 }),
        entry(dee, { bought: 100, net: -30 }),
      ])
    })

    it('for many winners against one loser', () => {
      clearsEveryNet([
        entry(ann, { bought: 100, net: -110 }),
        entry(bob, { bought: 100, net: 60 }),
        entry(cy, { bought: 100, net: 20 }),
        entry(dee, { bought: 100, net: 30 }),
      ])
    })

    it('when a debt and a credit clear each other exactly', () => {
      // Both sides hit zero on the same pass. The interesting case: a guard
      // that advanced only one index would leave the other pointing at a
      // cleared row and pay it again.
      clearsEveryNet([
        entry(ann, { bought: 100, net: 50 }),
        entry(bob, { bought: 100, net: -50 }),
        entry(cy, { bought: 100, net: 25 }),
        entry(dee, { bought: 100, net: -25 }),
      ])
    })

    it('when gamers who never played sit among those who did', () => {
      clearsEveryNet([
        entry(ann, { bought: 100, net: 40 }),
        entry(bob, { granted: 100 }),
        entry(cy, { bought: 100, net: -40 }),
        entry(dee, { bought: 100, net: 0 }),
      ])
    })

    it('across many pseudo-random zero-sum rooms', () => {
      // Seeded, so a failure is reproducible rather than a story about a
      // build that went red once.
      let seed = 20260818
      const next = (bound: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed % bound
      }

      for (let round = 0; round < 200; round += 1) {
        const size = 2 + next(6)
        const nets: number[] = []
        for (let i = 0; i < size - 1; i += 1) nets.push(next(401) - 200)
        // The last gamer absorbs the remainder, which is what makes the room
        // zero-sum: chips only enter by purchase, so play can only move them.
        nets.push(-nets.reduce((sum, value) => sum + value, 0))

        clearsEveryNet(
          nets.map((net, index) =>
            entry(GamerId(`g${String(index).padStart(2, '0')}`), { bought: 500, net }),
          ),
        )
      }
    })
  })

  describe('terminates on adversarial input', () => {
    it('when every net is zero', () => {
      const entries = [
        entry(ann, { bought: 100 }),
        entry(bob, { bought: 100 }),
        entry(cy, { bought: 100 }),
      ]

      expect(roomSettlement(entries).transfers).toEqual([])
    })

    it('when many equal debts meet many equal credits', () => {
      // Every pass clears both sides at once, so both indices advance
      // together. This is the shape that spins forever under a defensive
      // "skip if the amount is zero" guard, because neither index moves.
      const entries = Array.from({ length: 40 }, (_, index) =>
        entry(GamerId(`g${String(index).padStart(2, '0')}`), {
          bought: 100,
          net: index % 2 === 0 ? 25 : -25,
        }),
      )

      const { transfers } = roomSettlement(entries)
      expect(transfers.length).toBeLessThanOrEqual(entries.length - 1)
      clearsEveryNet(entries)
    })

    it('when one large debt is spread across many tiny credits', () => {
      const winners = Array.from({ length: 30 }, (_, index) =>
        entry(GamerId(`w${String(index).padStart(2, '0')}`), { bought: 100, net: 1 }),
      )
      const entries = [...winners, entry(ann, { bought: 100, net: -30 })]

      const { transfers } = roomSettlement(entries)
      expect(transfers).toHaveLength(30)
      clearsEveryNet(entries)
    })

    it('when the nets do not sum to zero', () => {
      // Cannot happen from a real fold — chips only enter by purchase — but a
      // settlement screen that hangs is worse than one that pays what it can.
      const { transfers } = roomSettlement([
        entry(ann, { bought: 100, net: 100 }),
        entry(bob, { bought: 100, net: -40 }),
      ])

      expect(transfers).toEqual([{ from: bob, to: ann, amount: 40 }])
    })

    it('when only losers are present', () => {
      expect(
        roomSettlement([
          entry(ann, { bought: 100, net: -40 }),
          entry(bob, { bought: 100, net: -60 }),
        ]).transfers,
      ).toEqual([])
    })

    it('when only winners are present', () => {
      expect(
        roomSettlement([
          entry(ann, { bought: 100, net: 40 }),
          entry(bob, { bought: 100, net: 60 }),
        ]).transfers,
      ).toEqual([])
    })
  })
})

describe('settlementText', () => {
  const nameOf = (id: string): string =>
    ({ ann: 'Ann', bob: 'Bob', cy: 'Cy', dee: 'Dee' })[id] ?? 'Unknown'

  it('names who pays whom, so it reads on its own in a chat', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 60 }),
      entry(bob, { bought: 100, net: -40 }),
      entry(cy, { bought: 100, net: -20 }),
    ])

    const text = settlementText(settlement, nameOf)

    expect(text).toContain('Ann +60')
    expect(text).toContain('Bob -40')
    expect(text).toContain('Bob pays Ann 40')
    expect(text).toContain('Cy pays Ann 20')
  })

  it('says so plainly when nobody owes anybody', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100 }),
      entry(bob, { bought: 100 }),
    ])

    expect(settlementText(settlement, nameOf)).toContain('Nobody owes anybody')
  })

  it('flags the stakes it had to leave out', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 50, committed: 30 }),
      entry(bob, { bought: 100, net: -50, committed: 20 }),
    ])

    // Anyone reading this in a group chat can see 50 chips are unaccounted
    // for; the line is what stops that looking like a bug.
    expect(settlementText(settlement, nameOf)).toContain('50')
    expect(settlementText(settlement, nameOf)).toMatch(/still riding|not settled|excludes/i)
  })

  it('leaves out the open-stakes line when nothing is riding', () => {
    const settlement = roomSettlement([
      entry(ann, { bought: 100, net: 50 }),
      entry(bob, { bought: 100, net: -50 }),
    ])

    expect(settlementText(settlement, nameOf)).not.toMatch(/still riding/i)
  })

  it('is stable, so two phones share the same message', () => {
    const entries = [
      entry(ann, { bought: 100, net: 40 }),
      entry(bob, { bought: 100, net: -25 }),
      entry(cy, { bought: 100, net: 40 }),
      entry(dee, { bought: 100, net: -55 }),
    ]

    expect(settlementText(roomSettlement([...entries].reverse()), nameOf)).toBe(
      settlementText(roomSettlement(entries), nameOf),
    )
  })
})
