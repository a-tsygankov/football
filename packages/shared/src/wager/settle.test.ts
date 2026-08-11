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

  it('breaks a remainder tie by the larger stake', () => {
    // pot 12, winning stake 5 → ann 2*12/5 = 4.8, bob 3*12/5 = 7.2.
    // Whole 4 + 7 = 11, one chip over. Remainders 4/5 vs 1/5 → ann takes it.
    const settled = settleWagers([bet(ann, 'home', 2), bet(bob, 'home', 3), bet(cy, 'away', 7)], 'home')

    expect(settled.map((s) => s.payout)).toEqual([5, 7, 0])
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
})
