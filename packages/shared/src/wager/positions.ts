import type {
  GameRecordedEvent,
  GameVoidedEvent,
  PersistedGameEvent,
} from '../types/events.js'
import type { GameNightId, GamerId } from '../types/ids.js'

/**
 * Recorded events for one game night that still count: right game night, not
 * voided, and carrying settled wagers. Sorted oldest-first by when the game
 * was played.
 *
 * Voided games are filtered out here rather than reversed anywhere, which is
 * why voiding a game needs no wager-specific rollback — the wagers simply stop
 * being derived.
 */
function settledGames(
  events: ReadonlyArray<PersistedGameEvent>,
  gameNightId: GameNightId,
): GameRecordedEvent[] {
  const voidedGameIds = new Set(
    events
      .map((event) => event.payload)
      .filter((payload): payload is GameVoidedEvent => payload.type === 'game_voided')
      .map((payload) => payload.gameId),
  )

  return events
    .map((event) => event.payload)
    .filter(
      (payload): payload is GameRecordedEvent =>
        payload.type === 'game_recorded' &&
        payload.gameNightId === gameNightId &&
        !voidedGameIds.has(payload.gameId) &&
        payload.wagers !== undefined &&
        payload.wagers.length > 0,
    )
    .sort((a, b) => a.occurredAt - b.occurredAt)
}

function accumulate(
  target: Map<GamerId, number>,
  payload: GameRecordedEvent,
): void {
  for (const wager of payload.wagers ?? []) {
    target.set(wager.gamerId, (target.get(wager.gamerId) ?? 0) + (wager.payout - wager.stake))
  }
}

/** Net chips per gamer for one game night: winnings minus stakes. */
export function nightChipPositions(
  events: ReadonlyArray<PersistedGameEvent>,
  gameNightId: GameNightId,
): Map<GamerId, number> {
  const positions = new Map<GamerId, number>()
  for (const payload of settledGames(events, gameNightId)) {
    accumulate(positions, payload)
  }
  return positions
}

/**
 * Per-gamer deltas from the most recently settled game of the night, so the
 * standings panel can highlight what just changed.
 */
export function lastSettledGameDeltas(
  events: ReadonlyArray<PersistedGameEvent>,
  gameNightId: GameNightId,
): Map<GamerId, number> {
  const games = settledGames(events, gameNightId)
  const latest = games[games.length - 1]
  const deltas = new Map<GamerId, number>()
  if (latest) accumulate(deltas, latest)
  return deltas
}
