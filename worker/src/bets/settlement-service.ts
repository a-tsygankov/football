import { type GameId, type GameResult, settleWagers, type WagerSettlement } from '@fc26/shared'
import type { AppDependencies } from '../dependencies.js'

/**
 * Settles the pool on a game and clears its live rows.
 *
 * The returned settlements go into the `game_recorded` payload, which becomes
 * the durable record — that is why the rows can be deleted here.
 */
export async function settleGameWagers(
  deps: AppDependencies,
  gameId: GameId,
  result: GameResult,
): Promise<WagerSettlement[]> {
  const bets = await deps.bets.listByGame(gameId)
  if (bets.length === 0) return []

  const settlements = settleWagers(
    bets.map((bet) => ({ gamerId: bet.gamerId, outcome: bet.outcome, stake: bet.stake })),
    result,
  )
  await deps.bets.deleteByGame(gameId)
  return settlements
}

/**
 * Drops a game's bets without settling. Used when a game is interrupted: no
 * recorded event exists, so there is nothing to write and everyone nets zero.
 */
export async function discardGameWagers(
  deps: AppDependencies,
  gameId: GameId,
): Promise<void> {
  await deps.bets.deleteByGame(gameId)
}
