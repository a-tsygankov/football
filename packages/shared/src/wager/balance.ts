import type { ChipPosition } from '../types/room-api.js'
import type { GamerId } from '../types/ids.js'

/**
 * Chips each participant starts a game night with.
 *
 * A round number that survives a bad run: at 100, a string of losing 10-chip
 * bets is a real dent rather than an instant bust, and the arithmetic stays
 * easy to do in your head at the table.
 *
 * Nights created before buy-ins existed default to this value at the database
 * level, so their standings keep meaning the same thing.
 */
export const DEFAULT_BUY_IN = 100

/**
 * What one gamer has, and what they can still risk, at a point in the night.
 *
 * Deliberately not stored anywhere. Every field is derived from the buy-in,
 * the settled `game_recorded` events and the live bet rows, so there is no
 * balance column that can drift out of step with the event log.
 */
export interface ChipBalance {
  gamerId: GamerId
  /** The stack everyone started the night with. */
  buyIn: number
  /** Net from games already settled tonight: winnings minus stakes. */
  settled: number
  /** Stakes riding on games that have not settled yet. */
  committed: number
  /** buyIn + settled — the stack, counting nothing that is still in play. */
  balance: number
  /** balance − committed — what may still be put at risk right now. */
  available: number
}

export function chipBalance(
  gamerId: GamerId,
  buyIn: number,
  settled: number,
  committed: number,
): ChipBalance {
  const balance = buyIn + settled
  return { gamerId, buyIn, settled, committed, balance, available: balance - committed }
}

/**
 * Balances for a whole pool.
 *
 * `positions` are the settled nets (what `nightChipPositions` produces, and
 * what the chips endpoint already returns); `openBets` are the live rows for
 * games that have not resolved. A gamer missing from either simply has zero
 * there, which is why everyone in `gamerIds` gets an entry whether or not they
 * have bet yet.
 */
export function chipBalances(
  gamerIds: ReadonlyArray<GamerId>,
  buyIn: number,
  positions: ReadonlyArray<ChipPosition>,
  openBets: ReadonlyArray<{ gamerId: GamerId; stake: number }>,
): Map<GamerId, ChipBalance> {
  const settled = new Map(positions.map((position) => [position.gamerId, position.net]))

  const committed = new Map<GamerId, number>()
  for (const bet of openBets) {
    committed.set(bet.gamerId, (committed.get(bet.gamerId) ?? 0) + bet.stake)
  }

  return new Map(
    gamerIds.map((gamerId) => [
      gamerId,
      chipBalance(gamerId, buyIn, settled.get(gamerId) ?? 0, committed.get(gamerId) ?? 0),
    ]),
  )
}

/**
 * The largest total position a gamer may hold on one particular game.
 *
 * `available` already has every open stake subtracted, including whatever they
 * have on this game. Adding that back is what makes moving or topping up an
 * existing position work: the chips are being re-committed, not committed
 * twice. Without it, a gamer who was fully in on a game could not even switch
 * which outcome they backed.
 */
export function maxStakeOnGame(balance: ChipBalance, currentStakeOnGame: number): number {
  return balance.available + currentStakeOnGame
}
