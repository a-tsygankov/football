import { describe, expect, it } from 'vitest'
import { GamerId } from '../types/ids.js'
import type { WagerBet } from './types.js'
import { settleWagers } from './settle.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')
const dee = GamerId('dee')

function bet(gamerId: ReturnType<typeof GamerId>, outcome: 'home' | 'away' | 'draw', stake: number): WagerBet {
  return { gamerId, outcome, stake }
}

/** A closed pool must neither create nor destroy chips. */
function netTotal(settlements: ReadonlyArray<{ stake: number; payout: number }>): number {
  return settlements.reduce((sum, s) => sum + (s.payout - s.stake), 0)
}

describe('settleWagers', () => {
  it('splits the pot in proportion to stake', () => {
    const settled = settleWagers([bet(ann, 'home', 50), bet(bob, 'away', 30), bet(cy, 'away', 20)], 'away')

    expect(settled).toEqual([
      { gamerId: ann, outcome: 'home', stake: 50, payout: 0 },
      { gamerId: bob, outcome: 'away', stake: 30, payout: 60 },
      { gamerId: cy, outcome: 'away', stake: 20, payout: 40 },
    ])
    expect(netTotal(settled)).toBe(0)
  })

  it('distributes indivisible chips to the largest fractional remainders', () => {
    // pot 10, winning stake 3 → 10/3 each is 3.33. Whole shares 3+3+3 = 9,
    // one chip left over, and all three remainders tie, so the largest stake
    // takes it. Stakes tie too, so the lowest gamerId wins: ann.
    const settled = settleWagers(
      [bet(ann, 'home', 1), bet(bob, 'home', 1), bet(cy, 'home', 1), bet(dee, 'away', 7)],
      'home',
    )

    expect(settled.map((s) => s.payout)).toEqual([4, 3, 3, 0])
    expect(netTotal(settled)).toBe(0)
  })

  it('gives the leftover to the larger fractional remainder', () => {
    // pot 12, winning stake 5 → ann 2*12/5 = 4.8, bob 3*12/5 = 7.2.
    // Whole 4 + 7 = 11, one chip over. Remainders 4/5 vs 1/5 → ann takes it.
    //
    // Named for what it measures: the remainders differ, so this settles on
    // the first comparator and never reaches the stake one. It used to be
    // called "breaks a remainder tie by the larger stake", which no test in
    // this file actually did — see below.
    const settled = settleWagers([bet(ann, 'home', 2), bet(bob, 'home', 3), bet(cy, 'away', 7)], 'home')

    expect(settled.map((s) => s.payout)).toEqual([5, 7, 0])
    expect(netTotal(settled)).toBe(0)
  })

  it('breaks a genuine remainder tie by the larger stake', () => {
    // pot 9, winning stake 6. ann 1*9/6 = 1.5 → whole 1 remainder 3;
    // bob 5*9/6 = 7.5 → whole 7 remainder 3. One chip over and the
    // remainders are equal, so the stake comparator decides it: bob.
    //
    // ann sorts first by gamerId, so if the stake rule were dropped or
    // reversed the chip would land on ann instead. That is what makes this
    // case pin the rule rather than agree with it by luck.
    const settled = settleWagers([bet(ann, 'home', 1), bet(bob, 'home', 5), bet(cy, 'away', 3)], 'home')

    expect(settled.map((s) => s.payout)).toEqual([1, 8, 0])
    expect(netTotal(settled)).toBe(0)
  })

  it('refunds everyone when nobody backed the result', () => {
    const settled = settleWagers([bet(ann, 'home', 50), bet(bob, 'home', 30)], 'draw')

    expect(settled.map((s) => s.payout)).toEqual([50, 30])
    expect(netTotal(settled)).toBe(0)
  })

  it('returns every stake when all bets backed the winner', () => {
    const settled = settleWagers([bet(ann, 'home', 50), bet(bob, 'home', 30)], 'home')

    expect(settled.map((s) => s.payout)).toEqual([50, 30])
    expect(netTotal(settled)).toBe(0)
  })

  it('pays a lone bettor their own stake back', () => {
    const settled = settleWagers([bet(ann, 'home', 40)], 'home')

    expect(settled).toEqual([{ gamerId: ann, outcome: 'home', stake: 40, payout: 40 }])
  })

  it('returns nothing when no bets were placed', () => {
    expect(settleWagers([], 'home')).toEqual([])
  })

  describe('hedged positions', () => {
    it('pays only the winning side of a hedge', () => {
      // Ann has money on both home and away. Keying payouts by gamer would
      // pay her winning share against both rows and mint chips out of nothing.
      const settled = settleWagers(
        [bet(ann, 'home', 60), bet(ann, 'away', 40), bet(bob, 'home', 40)],
        'home',
      )

      expect(settled).toEqual([
        { gamerId: ann, outcome: 'home', stake: 60, payout: 84 },
        { gamerId: ann, outcome: 'away', stake: 40, payout: 0 },
        { gamerId: bob, outcome: 'home', stake: 40, payout: 56 },
      ])
      expect(netTotal(settled)).toBe(0)
    })

    it('leaves a hedger net down when their losing side is bigger', () => {
      const settled = settleWagers(
        [bet(ann, 'home', 10), bet(ann, 'away', 90), bet(bob, 'home', 10)],
        'home',
      )

      // Pot 110, home stake 20, so Ann's 10 returns 55 against 100 committed.
      const annNet = settled
        .filter((s) => s.gamerId === ann)
        .reduce((sum, s) => sum + (s.payout - s.stake), 0)
      expect(annNet).toBe(-45)
      expect(netTotal(settled)).toBe(0)
    })

    it('refunds both sides of a hedge when nobody backed the result', () => {
      const settled = settleWagers([bet(ann, 'home', 30), bet(ann, 'away', 20)], 'draw')

      expect(settled.map((s) => s.payout)).toEqual([30, 20])
      expect(netTotal(settled)).toBe(0)
    })

    it('still balances when a hedger is the only winner', () => {
      const settled = settleWagers(
        [bet(ann, 'home', 25), bet(ann, 'away', 25), bet(bob, 'draw', 50)],
        'home',
      )

      // The whole 100 pot goes to the single winning row.
      expect(settled[0]!.payout).toBe(100)
      expect(settled[1]!.payout).toBe(0)
      expect(settled[2]!.payout).toBe(0)
      expect(netTotal(settled)).toBe(0)
    })

    it('gives each winning row its own remainder claim', () => {
      // Pot 100 over a winning stake of 3 divides to 33.33… each: two whole
      // chips are left to distribute, and the rows must be treated as three
      // separate claims even though two belong to the same gamer.
      const settled = settleWagers(
        [bet(ann, 'home', 1), bet(ann, 'draw', 97), bet(bob, 'home', 1), bet(cy, 'home', 1)],
        'home',
      )

      expect(netTotal(settled)).toBe(0)
      const paid = settled.filter((s) => s.outcome === 'home').map((s) => s.payout)
      expect(paid.reduce((a, b) => a + b, 0)).toBe(100)
      // Equal stakes, so the chips land one apiece rather than doubling up.
      expect(paid.every((p) => p === 33 || p === 34)).toBe(true)
    })
  })
})
