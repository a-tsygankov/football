import {
  type BetsDiscardedEvent,
  EVENT_SCHEMA_VERSION,
  EventId,
  type GameId,
  type GameResult,
  settleWagers,
  type WagerSettlement,
} from '@fc26/shared'
import { nanoid } from 'nanoid'
import type { AppDependencies } from '../dependencies.js'
import { toSnapshot } from './event-log.js'

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
 * Drops a game's bets without settling — an interrupted game, a voided one, or
 * a night that ended with a game unresolved. Everyone nets zero, but "a wash"
 * and "never happened" are different things: the stakes were committed, and
 * that belongs in the record. Previously these rows were deleted silently,
 * leaving no trace that the book had ever existed.
 */
export async function discardGameWagers(
  deps: AppDependencies,
  gameId: GameId,
  reason: BetsDiscardedEvent['reason'] = 'game_interrupted',
  correlationId: string | null = null,
): Promise<void> {
  const bets = await deps.bets.listByGame(gameId)
  await deps.bets.deleteByGame(gameId)
  if (bets.length === 0) return

  const first = bets[0]!
  const now = Date.now()
  const payload: BetsDiscardedEvent = {
    type: 'bets_discarded',
    schemaVersion: EVENT_SCHEMA_VERSION,
    roomId: first.roomId,
    gameNightId: first.gameNightId,
    gameId,
    occurredAt: now,
    bets: bets.map(toSnapshot),
    reason,
  }
  await deps.events.insert({
    id: EventId(nanoid(12)),
    roomId: payload.roomId,
    eventType: payload.type,
    payload,
    schemaVersion: payload.schemaVersion,
    correlationId,
    occurredAt: now,
    recordedAt: now,
  })
}
