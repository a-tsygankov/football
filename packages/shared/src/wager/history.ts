import type { BetHistoryGame } from '../types/room-api.js'
import type { GamerId } from '../types/ids.js'

/**
 * Did this gamer take part in a game's betting story?
 *
 * "Participating" covers both ways of being involved: playing the game, or
 * having money on it. Someone who backed a game they were not playing in has
 * every reason to see how it resolved, and a player has every reason to see
 * what was riding on them.
 *
 * Note `playerIds` is empty until a game is recorded, so a live game is
 * matched only through its bets. That is the honest answer — the event log
 * genuinely does not know who is playing until the result lands.
 */
export function participatedInBetGame(game: BetHistoryGame, gamerId: GamerId): boolean {
  if (game.playerIds.includes(gamerId)) return true

  return game.events.some((event) => {
    switch (event.type) {
      case 'bet_placed':
      case 'bet_removed':
        return event.gamerId === gamerId
      case 'bets_locked':
      case 'bets_discarded':
        return event.bets.some((bet) => bet.gamerId === gamerId)
    }
  })
}

/**
 * Narrow a bet history to the games one gamer was part of.
 *
 * This is a presentation filter, not access control. The room session is the
 * real trust boundary here — every member of a room can already read the whole
 * ledger through the API — so this exists to keep the view relevant, not to
 * keep anything secret. Pass `null` to show everything, which is what the
 * admin view does.
 */
export function filterBetHistory(
  games: ReadonlyArray<BetHistoryGame>,
  gamerId: GamerId | null,
): ReadonlyArray<BetHistoryGame> {
  if (gamerId === null) return games
  return games.filter((game) => participatedInBetGame(game, gamerId))
}

/** Net chips for one gamer on a settled game: payout minus stake. */
export function netForGamer(game: BetHistoryGame, gamerId: GamerId): number | null {
  if (!game.settled) return null
  const mine = game.settled.filter((entry) => entry.gamerId === gamerId)
  if (mine.length === 0) return null
  return mine.reduce((sum, entry) => sum + entry.payout - entry.stake, 0)
}
