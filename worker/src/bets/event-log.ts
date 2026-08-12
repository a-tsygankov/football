import { nanoid } from 'nanoid'
import {
  type Bet,
  type BetEventPayload,
  type BetSnapshot,
  EventId,
} from '@fc26/shared'
import type { RouteContext } from '../routes/room-context.js'

/**
 * Append-only record of everything that happens to a wager.
 *
 * The live `bets` table is deliberately transient — rows are replaced on a
 * re-bet and deleted at settlement — so without this the only surviving trace
 * of a wager was the settled `wagers` array on `game_recorded`. That lost
 * placement times, replaced stakes, removals, when the book closed, and any
 * game whose bets were discarded rather than settled.
 *
 * These ride in the same `game_events` table as the game events. `event_type`
 * has no CHECK constraint and every consumer filters on `payload.type`, so
 * adding types needed no migration and cannot disturb existing readers.
 */
export function toSnapshot(bet: Bet): BetSnapshot {
  return {
    betId: bet.id,
    gamerId: bet.gamerId,
    outcome: bet.outcome,
    stake: bet.stake,
  }
}

export async function recordBetEvent(
  c: RouteContext,
  payload: BetEventPayload,
): Promise<void> {
  await c.get('deps').events.insert({
    id: EventId(nanoid(12)),
    roomId: payload.roomId,
    eventType: payload.type,
    payload,
    schemaVersion: payload.schemaVersion,
    correlationId: c.get('correlationId') ?? null,
    occurredAt: payload.occurredAt,
    recordedAt: Date.now(),
  })
}
