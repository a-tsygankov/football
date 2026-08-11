import type { GameResult } from '../types/events.js'
import type { GamerId } from '../types/ids.js'
import type { WagerGameSides } from './types.js'

/**
 * A gamer playing in the game may back only their own side.
 *
 * Draw is blocked for participants as well as the opposing side: a draw stake
 * pays a participant for not winning, which is the same perverse incentive as
 * backing the opponent, only softer.
 */
export function canBack(
  gamerId: GamerId,
  game: WagerGameSides,
  outcome: GameResult,
): boolean {
  if (game.homeGamerIds.includes(gamerId)) return outcome === 'home'
  if (game.awayGamerIds.includes(gamerId)) return outcome === 'away'
  return true
}

/**
 * The reason `canBack` refused, phrased for the bettor. Null when allowed.
 * The UI shows this beside the disabled option, so the copy lives here rather
 * than in the component.
 */
export function describeIneligibility(
  gamerId: GamerId,
  game: WagerGameSides,
  outcome: GameResult,
): string | null {
  if (canBack(gamerId, game, outcome)) return null
  return game.homeGamerIds.includes(gamerId)
    ? "You're playing home — you can only back Home."
    : "You're playing away — you can only back Away."
}
