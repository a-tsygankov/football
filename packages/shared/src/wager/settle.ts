import type { GameResult, WagerSettlement } from '../types/events.js'
import type { GamerId } from '../types/ids.js'
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
 * Keying payouts by gamer ID is safe because the schema enforces one bet per
 * gamer per game.
 */
export function settleWagers(
  bets: ReadonlyArray<WagerBet>,
  result: GameResult,
): WagerSettlement[] {
  if (bets.length === 0) return []

  const pot = bets.reduce((sum, item) => sum + item.stake, 0)
  const winners = bets.filter((item) => item.outcome === result)
  const winningStake = winners.reduce((sum, item) => sum + item.stake, 0)

  if (winningStake === 0) {
    return bets.map((item) => ({
      gamerId: item.gamerId,
      outcome: item.outcome,
      stake: item.stake,
      payout: item.stake,
    }))
  }

  const shares = winners.map((item) => ({
    bet: item,
    whole: Math.floor((item.stake * pot) / winningStake),
    remainder: (item.stake * pot) % winningStake,
  }))

  const payoutByGamer = new Map<GamerId, number>(
    shares.map((share) => [share.bet.gamerId, share.whole]),
  )

  let leftover = pot - shares.reduce((sum, share) => sum + share.whole, 0)
  const byClaim = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.bet.stake - a.bet.stake ||
      (a.bet.gamerId < b.bet.gamerId ? -1 : a.bet.gamerId > b.bet.gamerId ? 1 : 0),
  )
  for (const share of byClaim) {
    if (leftover <= 0) break
    payoutByGamer.set(share.bet.gamerId, (payoutByGamer.get(share.bet.gamerId) ?? 0) + 1)
    leftover -= 1
  }

  return bets.map((item) => ({
    gamerId: item.gamerId,
    outcome: item.outcome,
    stake: item.stake,
    payout: payoutByGamer.get(item.gamerId) ?? 0,
  }))
}
