import { nanoid } from 'nanoid'
import {
  type Bet,
  type BetEventPayload,
  type BetHistoryGame,
  type BetHistoryResponse,
  isBetEvent,
  type BetPlacedEvent,
  type BetRemovedEvent,
  type BetSnapshot,
  type BetsLockedEvent,
  BetId,
  canBack,
  EVENT_SCHEMA_VERSION,
  type ChipPosition,
  type CurrentGame,
  GameId,
  GameNightId,
  GamerId,
  lastSettledGameDeltas,
  nightChipPositions,
  type PlaceBetRequest,
  RoomId,
} from '@fc26/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../app.js'
import { recordBetEvent, toSnapshot } from '../bets/event-log.js'
import {
  parseJson,
  requireActiveGameNight,
  requireRoomSession,
  type RouteContext,
} from './room-context.js'

/**
 * The stake cap keeps `stake × pot` well below 2^53 inside `settleWagers`,
 * where JS number arithmetic would start losing integer precision and the
 * pot would stop balancing to the chip.
 */
const MAX_STAKE = 1_000_000

const placeBetSchema = z.object({
  gamerId: z.string().min(1),
  outcome: z.enum(['home', 'away', 'draw']),
  stake: z.number().int().positive().max(MAX_STAKE),
})

export const betRoutes = new Hono<AppContext>()

const BETS_PATH = '/rooms/:roomId/game-nights/:gameNightId/games/:gameId/bets'

/**
 * Resolves the live game a bet route is targeting, or the error response to
 * return instead. Every bet route needs the same four checks, so they live
 * here rather than being repeated three times.
 */
async function resolveLiveGame(
  c: RouteContext,
): Promise<
  | { ok: true; roomId: ReturnType<typeof RoomId>; game: CurrentGame }
  | { ok: false; status: 401 | 404; error: string }
> {
  // Every route in this module matches BETS_PATH, so the params are present
  // even though the shared RouteContext cannot prove it.
  const roomId = RoomId(c.req.param('roomId')!)
  const session = await requireRoomSession(c, roomId)
  if (!session) return { ok: false, status: 401, error: 'unauthorized' }

  const gameNight = await requireActiveGameNight(
    c,
    roomId,
    GameNightId(c.req.param('gameNightId')!),
  )
  if (!gameNight) return { ok: false, status: 404, error: 'active_game_night_not_found' }

  const game = await c.get('deps').games.getActive(gameNight.id)
  if (!game || game.id !== GameId(c.req.param('gameId')!)) {
    return { ok: false, status: 404, error: 'active_game_not_found' }
  }

  return { ok: true, roomId, game }
}

async function betsResponse(c: RouteContext, game: CurrentGame) {
  return {
    bets: await c.get('deps').bets.listByGame(game.id),
    betsLockedAt: game.betsLockedAt,
  }
}

betRoutes.post(BETS_PATH, async (c) => {
  const resolved = await resolveLiveGame(c)
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status)
  const { roomId, game } = resolved

  if (game.betsLockedAt !== null) {
    return c.json({ error: 'bets_locked' }, 409)
  }

  const parsed = placeBetSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }
  const body = parsed.data satisfies PlaceBetRequest
  const gamerId = GamerId(body.gamerId)

  const pool = await c.get('deps').gameNights.listActiveGamers(game.gameNightId)
  if (!pool.some((entry) => entry.gamerId === gamerId)) {
    return c.json({ error: 'gamer_not_in_pool' }, 400)
  }

  if (!canBack(gamerId, game, body.outcome)) {
    return c.json({ error: 'outcome_not_allowed' }, 400)
  }

  const now = Date.now()
  const bet: Bet = {
    id: BetId(nanoid()),
    roomId,
    gameNightId: game.gameNightId,
    gameId: game.id,
    gamerId,
    outcome: body.outcome,
    stake: body.stake,
    createdAt: now,
    updatedAt: now,
  }
  // One bet per gamer per game, so an upsert silently overwrites. Capture what
  // it replaced before writing, or the previous stake and outcome would be
  // gone from the record entirely.
  const existing = (await c.get('deps').bets.listByGame(game.id)).find(
    (item) => item.gamerId === gamerId,
  )
  await c.get('deps').bets.upsert(bet)

  const placed: BetPlacedEvent = {
    type: 'bet_placed',
    schemaVersion: EVENT_SCHEMA_VERSION,
    roomId,
    gameNightId: game.gameNightId,
    gameId: game.id,
    occurredAt: now,
    ...toSnapshot(bet),
    ...(existing ? { replaced: toSnapshot(existing) } : {}),
  }
  await recordBetEvent(c, placed)

  return c.json(await betsResponse(c, game), 201)
})

betRoutes.delete(`${BETS_PATH}/:betId`, async (c) => {
  const resolved = await resolveLiveGame(c)
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status)
  const { game } = resolved

  if (game.betsLockedAt !== null) {
    return c.json({ error: 'bets_locked' }, 409)
  }

  const betId = BetId(c.req.param('betId'))
  // Read before deleting: the event needs the stake and outcome being undone.
  const removed = (await c.get('deps').bets.listByGame(game.id)).find(
    (item) => item.id === betId,
  )
  await c.get('deps').bets.remove(betId, game.id)

  if (removed) {
    const event: BetRemovedEvent = {
      type: 'bet_removed',
      schemaVersion: EVENT_SCHEMA_VERSION,
      roomId: removed.roomId,
      gameNightId: game.gameNightId,
      gameId: game.id,
      occurredAt: Date.now(),
      ...toSnapshot(removed),
    }
    await recordBetEvent(c, event)
  }

  return c.json(await betsResponse(c, game))
})

/**
 * Closes the book. Idempotent: locking an already-locked game returns the
 * existing timestamp rather than erroring, so a re-opened photo capture, a
 * double tap, or a manual lock followed by a photo all behave the same.
 */
betRoutes.post(`${BETS_PATH}/lock`, async (c) => {
  const resolved = await resolveLiveGame(c)
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status)
  const { game } = resolved

  if (game.betsLockedAt !== null) {
    return c.json(await betsResponse(c, game))
  }

  const now = Date.now()
  const locked = { ...game, betsLockedAt: now, updatedAt: now }
  await c.get('deps').games.update(locked)

  // Snapshot the book as it closed. After settlement the live rows are gone,
  // so this is the only record of what everyone was actually playing for.
  const openBets = await c.get('deps').bets.listByGame(game.id)
  const snapshots: BetSnapshot[] = openBets.map(toSnapshot)
  const lockedEvent: BetsLockedEvent = {
    type: 'bets_locked',
    schemaVersion: EVENT_SCHEMA_VERSION,
    roomId: resolved.roomId,
    gameNightId: game.gameNightId,
    gameId: game.id,
    occurredAt: now,
    bets: snapshots,
    pot: snapshots.reduce((sum, item) => sum + item.stake, 0),
  }
  await recordBetEvent(c, lockedEvent)

  return c.json(await betsResponse(c, locked))
})

function toPositions(net: ReadonlyMap<ReturnType<typeof GamerId>, number>): ChipPosition[] {
  return [...net.entries()]
    .map(([gamerId, value]) => ({ gamerId, net: value }))
    .sort((a, b) => b.net - a.net)
}

/**
 * The room's betting ledger, grouped by game.
 *
 * Deliberately returns everything the room has. Visibility filtering happens
 * in the UI, because the room session is the real trust boundary — it carries
 * no per-gamer identity, so the server has no way to tell members apart and
 * filtering here would be security theatre rather than access control.
 * `filterBetHistory` in @fc26/shared does the presentation-side narrowing.
 */
betRoutes.get('/rooms/:roomId/bet-history', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const all = await c.get('deps').events.listByRoom(roomId)

  // Voided games are excluded to match the scoreboard drill-down, which also
  // hides them — a deleted game should not linger in one view and not another.
  const voided = new Set(
    all.filter((e) => e.payload.type === 'game_voided').map((e) => e.payload.gameId),
  )

  const byGame = new Map<string, BetHistoryGame & { events: BetEventPayload[] }>()
  const ensure = (gameId: GameId, gameNightId: GameNightId, occurredAt: number) => {
    let entry = byGame.get(gameId)
    if (!entry) {
      entry = { gameId, gameNightId, occurredAt, playerIds: [], events: [] }
      byGame.set(gameId, entry)
    }
    // Track the latest activity so an unresolved book still sorts sensibly.
    if (occurredAt > entry.occurredAt) entry.occurredAt = occurredAt
    return entry
  }

  for (const event of all) {
    const payload = event.payload
    if (isBetEvent(payload)) {
      if (voided.has(payload.gameId)) continue
      ensure(payload.gameId, payload.gameNightId, payload.occurredAt).events.push(payload)
    } else if (payload.type === 'game_recorded') {
      if (voided.has(payload.gameId)) continue
      // A recorded game supplies both the players and the settled positions,
      // neither of which the bet events themselves carry.
      const entry = ensure(payload.gameId, payload.gameNightId, payload.occurredAt)
      entry.playerIds = [...payload.home.gamerIds, ...payload.away.gamerIds]
      entry.occurredAt = payload.occurredAt
      if (payload.wagers) entry.settled = payload.wagers
    }
  }

  // Games with no betting activity at all are not part of a betting ledger.
  const games = [...byGame.values()]
    .filter((game) => game.events.length > 0)
    .sort((a, b) => b.occurredAt - a.occurredAt)

  return c.json({ roomId, games } satisfies BetHistoryResponse)
})

// Deliberately no requireActiveGameNight here — standings stay readable after
// the night completes.
betRoutes.get('/rooms/:roomId/game-nights/:gameNightId/chips', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const gameNightId = GameNightId(c.req.param('gameNightId'))
  const events = await c.get('deps').events.listByRoom(roomId)

  return c.json({
    gameNightId,
    positions: toPositions(nightChipPositions(events, gameNightId)),
    lastGameDeltas: toPositions(lastSettledGameDeltas(events, gameNightId)),
  })
})
