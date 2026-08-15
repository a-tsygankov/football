import type { GameResult, WagerSettlement } from '../types/events.js'
import type { WagerBet } from './types.js'

/**
 * Settle a pari-mutuel pool.
 *
 * Every stake on the game forms one pot. Backers of `result` split it in
 * proportion to their stake. Flooring each share leaves at most
 * `winnerCount - 1` chips over; those go to the largest fractional
 * remainders, ties broken by the larger stake and then the lower gamer ID so
 * the outcome is deterministic and testable.
 *
 * When nobody backed `result` the pool cannot be divided, so every stake is
 * refunded and the game is a wash.
 *
 * Payouts are keyed by a bet's position in `bets`, not by gamer: a gamer may
 * hold one position per outcome, so the same person can appear on both a
 * winning and a losing row. Keying by gamer would pay the winning amount
 * against every row they hold, quietly inventing chips.
 */
export function settleWagers(
  bets: ReadonlyArray<WagerBet>,
  result: GameResult,
): WagerSettlement[] {
  if (bets.length === 0) return []

  const pot = bets.reduce((sum, item) => sum + item.stake, 0)
  const winners = bets
    .map((bet, index) => ({ bet, index }))
    .filter((item) => item.bet.outcome === result)
  const winningStake = winners.reduce((sum, item) => sum + item.bet.stake, 0)

  if (winningStake === 0) {
    return bets.map((item) => ({
      gamerId: item.gamerId,
      outcome: item.outcome,
      stake: item.stake,
      payout: item.stake,
    }))
  }

  const shares = winners.map((item) => ({
    bet: item.bet,
    index: item.index,
    whole: Math.floor((item.bet.stake * pot) / winningStake),
    remainder: (item.bet.stake * pot) % winningStake,
  }))

  const payoutByIndex = new Map<number, number>(
    shares.map((share) => [share.index, share.whole]),
  )

  let leftover = pot - shares.reduce((sum, share) => sum + share.whole, 0)
  const byClaim = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.bet.stake - a.bet.stake ||
      (a.bet.gamerId < b.bet.gamerId ? -1 : a.bet.gamerId > b.bet.gamerId ? 1 : 0) ||
      a.index - b.index,
  )
  for (const share of byClaim) {
    if (leftover <= 0) break
    payoutByIndex.set(share.index, (payoutByIndex.get(share.index) ?? 0) + 1)
    leftover -= 1
  }

  return bets.map((item, index) => ({
    gamerId: item.gamerId,
    outcome: item.outcome,
    stake: item.stake,
    payout: payoutByIndex.get(index) ?? 0,
  }))
}
