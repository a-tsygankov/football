import { describe, expect, it } from 'vitest'
import type { ChipPosition } from '../types/room-api.js'
import { GamerId } from '../types/ids.js'
import { DEFAULT_BUY_IN, chipBalance, chipBalances, maxStakeOnGame } from './balance.js'

const ann = GamerId('ann')
const bob = GamerId('bob')
const cy = GamerId('cy')

function positions(entries: Array<[typeof ann, number]>): ChipPosition[] {
  return entries.map(([gamerId, net]) => ({ gamerId, net }))
}

describe('chipBalance', () => {
  it('is the buy-in until something has been settled or staked', () => {
    const balance = chipBalance(ann, DEFAULT_BUY_IN, 0, 0)
    expect(balance.balance).toBe(DEFAULT_BUY_IN)
    expect(balance.available).toBe(DEFAULT_BUY_IN)
  })

  it('counts winnings into the stack and open stakes out of it', () => {
    const balance = chipBalance(ann, 100, 40, 25)
    expect(balance.balance).toBe(140)
    // The 25 is riding on an unresolved game, so it is not theirs to bet again.
    expect(balance.available).toBe(115)
  })

  it('goes negative when losses exceed the buy-in rather than clamping', () => {
    // Clamping at zero would quietly forgive a debt. The number is honest and
    // the caller decides what to do with it — betting is blocked because
    // available is not positive, not because it was rounded up.
    const balance = chipBalance(ann, 100, -140, 0)
    expect(balance.balance).toBe(-40)
    expect(balance.available).toBe(-40)
  })
})

describe('chipBalances', () => {
  it('gives everyone in the pool an entry, bet or not', () => {
    const balances = chipBalances([ann, bob, cy], 100, positions([[ann, 30]]), [
      { gamerId: bob, stake: 20 },
    ])

    expect(balances.get(ann)!.available).toBe(130)
    expect(balances.get(bob)!.available).toBe(80)
    // Cy has neither settled nor staked, and still shows up with a full stack.
    expect(balances.get(cy)!.available).toBe(100)
  })

  it('sums the stakes a gamer has across every open game', () => {
    const balances = chipBalances([ann], 100, [], [
      { gamerId: ann, stake: 20 },
      { gamerId: ann, stake: 35 },
    ])
    expect(balances.get(ann)!.committed).toBe(55)
    expect(balances.get(ann)!.available).toBe(45)
  })

  it('ignores positions for gamers outside the pool', () => {
    // A gamer dropped from the night mid-way still has settled events; asking
    // for balances of the current pool should not resurrect them.
    const balances = chipBalances([ann], 100, positions([[ann, 10], [bob, 500]]), [])
    expect(balances.has(bob)).toBe(false)
    expect(balances.size).toBe(1)
  })
})

describe('maxStakeOnGame', () => {
  it('lets an existing position be re-committed rather than double-counted', () => {
    // 100 buy-in, all 100 already on this game. Available is 0, but switching
    // outcome or restating the same 100 must still be possible.
    const balance = chipBalance(ann, 100, 0, 100)
    expect(balance.available).toBe(0)
    expect(maxStakeOnGame(balance, 100)).toBe(100)
  })

  it('does not free up chips riding on a different game', () => {
    // 100 buy-in, 40 on this game and 30 on another that has not resolved.
    const balance = chipBalance(ann, 100, 0, 70)
    expect(maxStakeOnGame(balance, 40)).toBe(70)
  })
})
