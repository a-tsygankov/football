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
  type ChipLedgerResponse,
  type ChipPosition,
  type CurrentGame,
  GameId,
  type GameNight,
  GameNightId,
  type GameVoidedEvent,
  GamerId,
  lastSettledGameDeltas,
  nightChipPositions,
  type PlaceBetRequest,
  moneyHistory,
  roomChipLedger,
  settlementAmounts,
  settlementForPayment,
  RoomId,
  settleUp,
} from '@fc26/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../app.js'
import {
  recordBetEvent,
  recordChipPurchase,
  recordChipSettlement,
  toSnapshot,
} from '../bets/event-log.js'
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
  | { ok: true; roomId: ReturnType<typeof RoomId>; gameNight: GameNight; game: CurrentGame }
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

  return { ok: true, roomId, gameNight, game }
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

  // Night-wide rather than this game's book: the balance check below has to
  // count everything the gamer already has at risk, and settlement is what
  // clears rows, so every row still here is still live.
  const openBets = await c.get('deps').bets.listByGameNight(game.gameNightId)

  // One position per outcome, so a repeat bet on the same outcome lands on the
  // existing row. Find it first: it decides whether this is a top-up, and the
  // event log needs what was there before the write destroys it.
  //
  // Backing a *different* outcome opens a second position rather than moving
  // the first — that is what hedging is. Moving a position is now remove then
  // place, which is the honest description of what it costs.
  const existing = openBets.find(
    (item) =>
      item.gameId === game.id &&
      item.gamerId === gamerId &&
      item.outcome === body.outcome,
  )

  // "Another 20 on Home" should mean 20 more, not a silent reset to 20.
  const stake = existing ? existing.stake + body.stake : body.stake

  // The schema caps each request; a top-up has to be capped on the total too,
  // or repeated increments would walk past the limit that keeps
  // `stake * pot` inside exact-integer range in settleWagers.
  if (stake > MAX_STAKE) {
    return c.json({ error: 'stake_cap_exceeded', max: MAX_STAKE, stake }, 400)
  }

  // No solvency check, deliberately. Chips are a tally of who is up and who is
  // down, not a bankroll that has to be funded before anyone may play: this is
  // a room of people who know each other, and the thing they want at the end
  // of the night is "who pays whom", not a refusal at the table.
  //
  // Wagering only moves chips between gamers, so a pot is always covered by
  // the losers of that same pot however little anybody bought. A gamer who
  // never bought a chip and loses 20 lands at −20, which is a debt `settleUp`
  // collects — not an inconsistency in the ledger. `MAX_STAKE` above is the
  // only ceiling, and it is there for integer precision rather than for
  // credit.

  const now = Date.now()
  const bet: Bet = {
    // A top-up is the same position, so it keeps its id and created_at. The D1
    // upsert preserves the original row id on conflict regardless; being
    // explicit keeps the in-memory repository behaving identically, since it
    // deletes and re-inserts.
    id: existing?.id ?? BetId(nanoid()),
    roomId,
    gameNightId: game.gameNightId,
    gameId: game.id,
    gamerId,
    outcome: body.outcome,
    stake,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
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

/**
 * The room ledger, with the open stakes that are not yet anyone's to bet.
 *
 * Live bet rows only ever belong to the active night — ending a night sweeps
 * whatever is left — so the active night's book is the whole of the room's
 * unresolved exposure.
 */
async function chipLedgerResponse(
  c: RouteContext,
  roomId: ReturnType<typeof RoomId>,
): Promise<ChipLedgerResponse> {
  const activeNight = await c.get('deps').gameNights.getActive(roomId)
  const openBets = activeNight
    ? await c.get('deps').bets.listByGameNight(activeNight.id)
    : []
  const events = await c.get('deps').events.listByRoom(roomId)
  const ledger = roomChipLedger(events, openBets)

  return {
    roomId,
    entries: [...ledger.values()].sort((a, b) => b.balance - a.balance),
    transfers: settleUp(ledger.values()),
  }
}

const purchaseSchema = z.object({
  gamerId: z.string().min(1),
  // Capped at the stake ceiling: a balance settlement could not divide
  // exactly beyond it, and no game night needs a bigger single purchase.
  amount: z.number().int().positive().max(MAX_STAKE),
})

/**
 * Buys chips into the room.
 *
 * Deliberately available at any time rather than only when a night starts —
 * running dry mid-evening is exactly when someone needs to buy more, and
 * making them wait for the next night would be the wrong shape.
 */
betRoutes.post('/rooms/:roomId/chips/purchases', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const parsed = purchaseSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }
  const gamerId = GamerId(parsed.data.gamerId)

  const gamer = await c.get('deps').gamers.get(roomId, gamerId)
  if (!gamer) {
    return c.json({ error: 'unknown_gamer', gamerId }, 400)
  }

  const activeNight = await c.get('deps').gameNights.getActive(roomId)
  const now = Date.now()
  await recordChipPurchase(c, {
    type: 'chips_purchased',
    schemaVersion: EVENT_SCHEMA_VERSION,
    roomId,
    gamerId,
    amount: parsed.data.amount,
    gameNightId: activeNight?.id ?? null,
    occurredAt: now,
    reason: 'manual',
  })

  return c.json(await chipLedgerResponse(c, roomId), 201)
})

/**
 * Records that the room squared up.
 *
 * Takes no body: the amounts are whatever the ledger says right now, so there
 * is nothing for a caller to get wrong or to disagree with the panel about.
 * One `chips_settled` event per gamer who is not already square, all sharing a
 * settlement id, each cancelling exactly that gamer's outstanding position.
 *
 * Chips are not returned. Settling pays the debt in cash and leaves everyone
 * holding what they bought, which is what makes the next night start from the
 * stacks people paid for rather than from nothing.
 *
 * Open stakes are deliberately not waited for. `settleUp` already ignores
 * them, so a live game simply settles into a fresh balance afterwards — and
 * refusing here would mean nobody could square up until the last game of the
 * night had been recorded.
 */
const paymentSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.number().int().positive().max(MAX_STAKE),
})

/**
 * Records one payment between two gamers.
 *
 * Separate from the whole-room route on purpose. `parseJson` cannot tell a
 * missing body from a malformed one, so a single route keyed on "did a body
 * arrive" would settle the entire room the day a client sent broken JSON.
 * Two routes make the intent explicit and unmistakable.
 *
 * Debts are rarely cleared in one round — somebody pays on Tuesday, somebody
 * else forgets until next month, somebody pays half now — so a payment stands
 * on its own and leaves everyone else's position untouched.
 */
betRoutes.post('/rooms/:roomId/chips/settlements/payment', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const parsed = paymentSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const events = await c.get('deps').events.listByRoom(roomId)
  const ledger = roomChipLedger(events)
  const amounts = settlementForPayment(
    ledger,
    GamerId(parsed.data.from),
    GamerId(parsed.data.to),
    parsed.data.amount,
  )
  // Null means the payment answers to no debt the games created — paying
  // somebody who is not owed, or paying more than they are owed.
  if (!amounts) {
    return c.json({ error: 'no_such_debt' }, 400)
  }

  await writeSettlement(c, roomId, amounts)
  return c.json(await chipLedgerResponse(c, roomId), 201)
})

/** Appends one settlement round: every amount shares an id and they cancel. */
async function writeSettlement(
  c: RouteContext,
  roomId: ReturnType<typeof RoomId>,
  amounts: ReadonlyArray<{ gamerId: ReturnType<typeof GamerId>; amount: number }>,
): Promise<void> {
  const settlementId = nanoid(12)
  const now = Date.now()
  for (const entry of amounts) {
    await recordChipSettlement(c, {
      type: 'chips_settled',
      schemaVersion: EVENT_SCHEMA_VERSION,
      roomId,
      gamerId: entry.gamerId,
      amount: entry.amount,
      settlementId,
      occurredAt: now,
    })
  }
}

/**
 * Records that the whole room squared up at once.
 *
 * Takes no body: the amounts are whatever the ledger says right now, so there
 * is nothing for a caller to get wrong or to disagree with the panel about.
 *
 * Chips are not returned. Settling pays the debt in cash and leaves everyone
 * holding what they bought, which is what makes the next night start from the
 * stacks people paid for rather than from nothing.
 *
 * Open stakes are deliberately not waited for. `settleUp` already ignores
 * them, so a live game simply settles into a fresh balance afterwards — and
 * refusing here would mean nobody could square up until the last game of the
 * night had been recorded.
 */
betRoutes.post('/rooms/:roomId/chips/settlements', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const events = await c.get('deps').events.listByRoom(roomId)
  const ledger = roomChipLedger(events)
  const amounts = settlementAmounts(ledger.values())
  if (amounts.length === 0) {
    return c.json({ error: 'nothing_to_settle' }, 400)
  }

  await writeSettlement(c, roomId, amounts)
  return c.json(await chipLedgerResponse(c, roomId), 201)
})

/** The room's chip ledger, plus the payments that would close it out. */
betRoutes.get('/rooms/:roomId/chips-ledger', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  return c.json(await chipLedgerResponse(c, roomId))
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
    all
      .map((e) => e.payload)
      .filter((p): p is GameVoidedEvent => p.type === 'game_voided')
      .map((p) => p.gameId),
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

  // Purchases and settlements ride along: the Wager page renders both halves
  // of the story and a second round trip for one screen buys nothing.
  return c.json({ roomId, games, money: moneyHistory(all) } satisfies BetHistoryResponse)
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
