import { nanoid } from 'nanoid'
import {
  type CreateCurrentGameRequest,
  type CreateGamerRequest,
  type CreateRoomRequest,
  type CurrentGame,
  DEFAULT_STRATEGY_ID,
  type GameNight,
  GameNightId,
  type GameNightActiveGamer,
  GAME_FORMATS,
  GamerId,
  GameId,
  getStrategy,
  inferGameFormat,
  isValidNameStem,
  type JoinRoomRequest,
  mulberry32,
  normalizeNameStem,
  type Room,
  type RoomBootstrapResponse,
  RoomId,
  type RoomId as RoomIdType,
  seedFromCrypto,
  shuffleInPlace,
  type UpdateGamerRequest,
  type UpdateGameNightActiveGamersRequest,
} from '@fc26/shared'
import { Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppContext } from '../app.js'
import type { PinAttempt } from '../auth/pin-attempt-repository.js'
import { hashPin, isValidPin, verifyPin } from '../auth/pin.js'
import {
  ROOM_SESSION_COOKIE,
  ROOM_SESSION_TTL_MS,
  signRoomSession,
  type RoomSessionPayload,
  verifyRoomSession,
} from '../auth/session.js'
import { toRoomSummary } from '../rooms/repository.js'
import { toPublicGamer } from '../gamers/repository.js'

const GAME_NIGHT_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000
type RouteContext = Context<AppContext>

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pin: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  defaultSelectionStrategy: z.string().trim().min(1).max(64).optional(),
})

const joinRoomSchema = z.object({
  identifier: z.string().trim().min(1).optional(),
  pin: z.string().nullable().optional(),
})

const createGamerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rating: z.number().int().min(1).max(5).optional(),
  active: z.boolean().optional(),
  pin: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const updateGamerSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  active: z.boolean().optional(),
  currentPin: z.string().nullable().optional(),
  pin: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const createGameNightSchema = z.object({
  activeGamerIds: z.array(z.string().min(1)).optional(),
})

const updateGameNightActiveGamersSchema = z.object({
  activeGamerIds: z.array(z.string().min(1)).min(2),
})

const createCurrentGameSchema = z.discriminatedUnion('allocationMode', [
  z.object({
    allocationMode: z.literal('manual'),
    homeGamerIds: z.array(z.string().min(1)).min(1).max(2),
    awayGamerIds: z.array(z.string().min(1)).min(1).max(2),
  }),
  z.object({
    allocationMode: z.literal('random'),
    format: z.enum(['1v1', '1v2', '2v1', '2v2']),
    selectionStrategyId: z.string().trim().min(1).max(64).optional(),
  }),
])

export const roomRoutes = new Hono<AppContext>()

roomRoutes.post('/rooms', async (c) => {
  const parsed = createRoomSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const body = parsed.data satisfies CreateRoomRequest
  if (!isValidNameStem(body.name)) {
    return c.json({ error: 'invalid_room_name_stem' }, 400)
  }
  const nameKey = normalizeNameStem(body.name)
  if (
    (await c.get('deps').rooms.getByNameKey(nameKey)) ||
    (await c.get('deps').gamers.getByNameKey(nameKey))
  ) {
    return c.json({ error: 'room_name_taken', nameKey }, 409)
  }
  const strategyId = body.defaultSelectionStrategy ?? DEFAULT_STRATEGY_ID
  try {
    getStrategy(strategyId)
  } catch {
    return c.json({ error: 'invalid_strategy', strategyId }, 400)
  }

  if (body.pin && !isValidPin(body.pin)) {
    return c.json({ error: 'invalid_pin_format' }, 400)
  }

  const now = Date.now()
  let pinHash: string | null = null
  let pinSalt: string | null = null
  if (body.pin) {
    const hashed = await hashPin(body.pin)
    pinHash = hashed.hash
    pinSalt = hashed.salt
  }

  const room: Room = {
    id: RoomId(nanoid(10)),
    name: body.name.trim(),
    nameKey,
    avatarUrl: body.avatarUrl ?? null,
    pinHash,
    pinSalt,
    defaultSelectionStrategy: strategyId,
    createdAt: now,
    updatedAt: now,
  }

  await c.get('deps').rooms.insert(room)
  const session = await issueRoomSession(c, room.id, now)
  return c.json(await buildBootstrap(c, room.id, session.exp, now), 201)
})

roomRoutes.post('/rooms/:roomId/sessions', async (c) => {
  const parsed = joinRoomSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const requestedLookup = parsed.data.identifier?.trim() || c.req.param('roomId')
  const room = await resolveRoomByLookup(c, requestedLookup)
  if (!room) return c.json({ error: 'not_found', lookup: requestedLookup }, 404)
  const roomId = room.id

  const body = parsed.data satisfies JoinRoomRequest
  const now = Date.now()
  const ip = resolveClientIp(c.req.raw)
  if (room.pinHash && room.pinSalt) {
    const attempt = await c.get('deps').pinAttempts.get(roomId, ip)
    if (attempt?.lockedUntil && attempt.lockedUntil > now) {
      return c.json({ error: 'pin_locked', lockedUntil: attempt.lockedUntil }, 429)
    }

    if (!body.pin || !isValidPin(body.pin)) {
      return c.json({ error: 'invalid_pin' }, 401)
    }

    const ok = await verifyPin(body.pin, room.pinSalt, room.pinHash)
    if (!ok) {
      const nextAttempt = nextPinAttempt(roomId, ip, attempt, now)
      await c.get('deps').pinAttempts.upsert(nextAttempt)
      return c.json(
        {
          error: nextAttempt.lockedUntil ? 'pin_locked' : 'invalid_pin',
          lockedUntil: nextAttempt.lockedUntil,
        },
        nextAttempt.lockedUntil ? 429 : 401,
      )
    }

    await c.get('deps').pinAttempts.clear(roomId, ip)
  }

  const session = await issueRoomSession(c, roomId, now)
  return c.json(await buildBootstrap(c, roomId, session.exp, now))
})

roomRoutes.get('/rooms/:roomId/bootstrap', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  return c.json(await buildBootstrap(c, roomId, session.exp, Date.now()))
})

roomRoutes.post('/rooms/:roomId/gamers', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const room = await c.get('deps').rooms.get(roomId)
  if (!room) return c.json({ error: 'not_found', roomId }, 404)

  const parsed = createGamerSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const body = parsed.data satisfies CreateGamerRequest
  if (!isValidNameStem(body.name)) {
    return c.json({ error: 'invalid_gamer_name_stem' }, 400)
  }
  const nameKey = normalizeNameStem(body.name)
  const existingGamerByName = await c.get('deps').gamers.getByNameKey(nameKey)
  const existingRoomByName = await c.get('deps').rooms.getByNameKey(nameKey)
  if (existingGamerByName || existingRoomByName) {
    return c.json({ error: 'gamer_name_taken', nameKey }, 409)
  }
  if (body.pin && !isValidPin(body.pin)) {
    return c.json({ error: 'invalid_pin_format' }, 400)
  }
  const now = Date.now()
  let pinHash: string | null = null
  let pinSalt: string | null = null
  if (body.pin) {
    const hashed = await hashPin(body.pin)
    pinHash = hashed.hash
    pinSalt = hashed.salt
  }
  const gamer = {
    id: GamerId(nanoid(10)),
    roomId,
    name: body.name.trim(),
    nameKey,
    rating: body.rating ?? 3,
    active: body.active ?? true,
    hasPin: Boolean(pinHash),
    pinHash,
    pinSalt,
    avatarUrl: body.avatarUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }

  await c.get('deps').gamers.insert(gamer)
  return c.json({ gamer: toPublicGamer(gamer) }, 201)
})

roomRoutes.patch('/rooms/:roomId/gamers/:gamerId', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const gamerId = GamerId(c.req.param('gamerId'))
  const existing = await c.get('deps').gamers.get(roomId, gamerId)
  if (!existing) {
    return c.json({ error: 'not_found', roomId, gamerId }, 404)
  }

  const parsed = updateGamerSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const body = parsed.data satisfies UpdateGamerRequest
  if (body.currentPin && !isValidPin(body.currentPin)) {
    return c.json({ error: 'invalid_pin_format' }, 400)
  }
  if (body.pin !== undefined && body.pin !== null && body.pin !== '' && !isValidPin(body.pin)) {
    return c.json({ error: 'invalid_pin_format' }, 400)
  }

  if (existing.pinHash && existing.pinSalt) {
    if (!body.currentPin) {
      return c.json({ error: 'gamer_pin_required', gamerId }, 401)
    }
    const ok = await verifyPin(body.currentPin, existing.pinSalt, existing.pinHash)
    if (!ok) {
      return c.json({ error: 'invalid_gamer_pin', gamerId }, 401)
    }
  }

  const nextName = body.name?.trim() ?? existing.name
  if (!isValidNameStem(nextName)) {
    return c.json({ error: 'invalid_gamer_name_stem' }, 400)
  }
  const nextNameKey = normalizeNameStem(nextName)
  const existingGamerByName = await c.get('deps').gamers.getByNameKey(nextNameKey)
  if (existingGamerByName && existingGamerByName.id !== existing.id) {
    return c.json({ error: 'gamer_name_taken', nameKey: nextNameKey }, 409)
  }
  const existingRoomByName = await c.get('deps').rooms.getByNameKey(nextNameKey)
  if (existingRoomByName) {
    return c.json({ error: 'gamer_name_taken', nameKey: nextNameKey }, 409)
  }

  if (body.active === false) {
    const activeGameNight = await getFreshActiveGameNight(c, roomId, Date.now())
    if (activeGameNight) {
      const activeGamers = await c.get('deps').gameNights.listActiveGamers(activeGameNight.id)
      if (activeGamers.some((activeGamer) => activeGamer.gamerId === gamerId)) {
        return c.json({ error: 'gamer_active_in_game_night', gamerId }, 409)
      }
    }
  }

  let nextPinHash = existing.pinHash
  let nextPinSalt = existing.pinSalt
  if (body.pin !== undefined) {
    if (!body.pin) {
      nextPinHash = null
      nextPinSalt = null
    } else {
      const hashed = await hashPin(body.pin)
      nextPinHash = hashed.hash
      nextPinSalt = hashed.salt
    }
  }

  const updated = {
    ...existing,
    name: nextName,
    nameKey: nextNameKey,
    rating: body.rating ?? existing.rating,
    active: body.active ?? existing.active,
    hasPin: Boolean(nextPinHash),
    pinHash: nextPinHash,
    pinSalt: nextPinSalt,
    avatarUrl: body.avatarUrl !== undefined ? body.avatarUrl : existing.avatarUrl,
    updatedAt: Date.now(),
  }

  await c.get('deps').gamers.update(updated)
  return c.json({ gamer: toPublicGamer(updated) })
})

roomRoutes.post('/rooms/:roomId/game-nights', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const parsed = createGameNightSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const now = Date.now()
  const existing = await getFreshActiveGameNight(c, roomId, now)
  if (existing) {
    return c.json({ error: 'active_game_night_exists', gameNightId: existing.id }, 409)
  }

  const allGamers = await c.get('deps').gamers.listByRoom(roomId)
  const requestedIds = parsed.data.activeGamerIds
    ? new Set(parsed.data.activeGamerIds.map((id) => GamerId(id)))
    : new Set(allGamers.filter((gamer) => gamer.active).map((gamer) => gamer.id))

  const roomGamersById = new Map(allGamers.map((gamer) => [gamer.id, gamer]))
  for (const gamerId of requestedIds) {
    const gamer = roomGamersById.get(gamerId)
    if (!gamer) return c.json({ error: 'unknown_gamer', gamerId }, 400)
    if (!gamer.active) return c.json({ error: 'inactive_gamer', gamerId }, 400)
  }

  if (requestedIds.size < 2) {
    return c.json({ error: 'not_enough_active_gamers' }, 400)
  }

  const gameNightId = GameNightId(nanoid(10))
  const gameNight: GameNight = {
    id: gameNightId,
    roomId,
    status: 'active',
    startedAt: now,
    endedAt: null,
    lastGameAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const activeGamers: GameNightActiveGamer[] = [...requestedIds].map((gamerId) => ({
    gameNightId,
    roomId,
    gamerId,
    joinedAt: now,
    updatedAt: now,
  }))

  await c.get('deps').gameNights.create(gameNight, activeGamers)
  return c.json({ gameNight, activeGamers }, 201)
})

roomRoutes.patch('/rooms/:roomId/game-nights/:gameNightId/active-gamers', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const gameNight = await requireActiveGameNight(c, roomId, GameNightId(c.req.param('gameNightId')))
  if (!gameNight) {
    return c.json({ error: 'active_game_night_not_found' }, 404)
  }

  const parsed = updateGameNightActiveGamersSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const body = parsed.data satisfies UpdateGameNightActiveGamersRequest
  const allGamers = await c.get('deps').gamers.listByRoom(roomId)
  const roomGamersById = new Map(allGamers.map((gamer) => [gamer.id, gamer]))
  const requestedIds = dedupeGamerIds(body.activeGamerIds)
  if (requestedIds.length < 2) {
    return c.json({ error: 'not_enough_active_gamers' }, 400)
  }

  for (const gamerId of requestedIds) {
    const gamer = roomGamersById.get(gamerId)
    if (!gamer) return c.json({ error: 'unknown_gamer', gamerId }, 400)
    if (!gamer.active) return c.json({ error: 'inactive_gamer', gamerId }, 400)
  }

  const currentGame = await c.get('deps').games.getActive(gameNight.id)
  if (currentGame) {
    for (const gamerId of [...currentGame.homeGamerIds, ...currentGame.awayGamerIds]) {
      if (!requestedIds.includes(gamerId)) {
        return c.json({ error: 'gamer_active_in_current_game', gamerId }, 409)
      }
    }
  }

  const activeGamers = await c
    .get('deps')
    .gameNights.replaceActiveGamers(gameNight.id, roomId, requestedIds, Date.now())
  return c.json({ gameNight, activeGamers })
})

roomRoutes.post('/rooms/:roomId/game-nights/:gameNightId/games', async (c) => {
  const roomId = RoomId(c.req.param('roomId'))
  const session = await requireRoomSession(c, roomId)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const gameNight = await requireActiveGameNight(c, roomId, GameNightId(c.req.param('gameNightId')))
  if (!gameNight) {
    return c.json({ error: 'active_game_night_not_found' }, 404)
  }

  const room = await c.get('deps').rooms.get(roomId)
  if (!room) return c.json({ error: 'not_found', roomId }, 404)

  const existingGame = await c.get('deps').games.getActive(gameNight.id)
  if (existingGame) {
    return c.json({ error: 'active_game_exists', gameId: existingGame.id }, 409)
  }

  const parsed = createCurrentGameSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const body = parsed.data satisfies CreateCurrentGameRequest
  const allGamers = await c.get('deps').gamers.listByRoom(roomId)
  const gamersById = new Map(allGamers.map((gamer) => [gamer.id, gamer]))
  const activeGameNightGamers = await c.get('deps').gameNights.listActiveGamers(gameNight.id)
  const activeGameNightGamerIds = new Set(activeGameNightGamers.map((item) => item.gamerId))

  const now = Date.now()
  let currentGame: CurrentGame
  if (body.allocationMode === 'manual') {
    const homeGamerIds = dedupeGamerIds(body.homeGamerIds)
    const awayGamerIds = dedupeGamerIds(body.awayGamerIds)
    let format
    try {
      format = validateManualGameSides(
        homeGamerIds,
        awayGamerIds,
        activeGameNightGamerIds,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('duplicate_manual_gamers:')) {
        return c.json({ error: 'duplicate_manual_gamers' }, 400)
      }
      if (message.startsWith('gamer_not_active_in_game_night:')) {
        return c.json({ error: 'gamer_not_active_in_game_night' }, 400)
      }
      return c.json({ error: 'invalid_manual_format' }, 400)
    }
    currentGame = {
      id: GameId(nanoid(10)),
      roomId,
      gameNightId: gameNight.id,
      status: 'active',
      allocationMode: 'manual',
      format,
      homeGamerIds,
      awayGamerIds,
      selectionStrategyId: 'manual',
      randomSeed: null,
      createdAt: now,
      updatedAt: now,
    }
  } else {
    const strategyId = body.selectionStrategyId ?? room.defaultSelectionStrategy
    const formatDefinition = GAME_FORMATS[body.format]
    let strategy
    try {
      strategy = getStrategy(strategyId)
    } catch {
      return c.json({ error: 'invalid_strategy', strategyId }, 400)
    }

    const activeRoster = [...activeGameNightGamerIds].flatMap((gamerId) => {
      const gamer = gamersById.get(gamerId)
      return gamer ? [gamer] : []
    })
    if (activeRoster.length !== activeGameNightGamerIds.size) {
      return c.json({ error: 'active_gamer_lookup_failed' }, 500)
    }

    const seed = seedFromCrypto()
    const rng = mulberry32(seed)
    let picked
    try {
      picked = strategy.select(activeRoster, formatDefinition.size, new Set(), {
        stats: new Map(),
        recentEvents: [],
        rng,
        now,
      })
    } catch (error) {
      return c.json(
        {
          error: 'selection_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      )
    }

    const shuffled = shuffleInPlace([...picked], rng)
    currentGame = {
      id: GameId(nanoid(10)),
      roomId,
      gameNightId: gameNight.id,
      status: 'active',
      allocationMode: 'random',
      format: body.format,
      homeGamerIds: shuffled.slice(0, formatDefinition.homeSize).map((gamer) => gamer.id),
      awayGamerIds: shuffled
        .slice(formatDefinition.homeSize, formatDefinition.homeSize + formatDefinition.awaySize)
        .map((gamer) => gamer.id),
      selectionStrategyId: strategyId,
      randomSeed: seed,
      createdAt: now,
      updatedAt: now,
    }
  }

  await c.get('deps').games.create(currentGame)
  await c.get('deps').gameNights.touchLastGameAt(gameNight.id, now)
  return c.json({ currentGame }, 201)
})

async function buildBootstrap(
  c: RouteContext,
  roomId: RoomIdType,
  expiresAt: number,
  now: number,
): Promise<RoomBootstrapResponse> {
  const room = await c.get('deps').rooms.get(roomId)
  if (!room) throw new Error(`room ${roomId} not found during bootstrap`)

  const activeGameNight = await getFreshActiveGameNight(c, roomId, now)
  const activeGameNightGamers = activeGameNight
    ? await c.get('deps').gameNights.listActiveGamers(activeGameNight.id)
    : []
  const currentGame = activeGameNight
    ? await c.get('deps').games.getActive(activeGameNight.id)
    : null

  return {
    room: toRoomSummary(room),
    gamers: (await c.get('deps').gamers.listByRoom(roomId)).map(toPublicGamer),
    activeGameNight,
    activeGameNightGamers,
    currentGame,
    session: { roomId, expiresAt },
  }
}

async function getFreshActiveGameNight(
  c: RouteContext,
  roomId: RoomIdType,
  now: number,
): Promise<GameNight | null> {
  const active = await c.get('deps').gameNights.getActive(roomId)
  if (!active) return null

  const lastActivityAt = active.lastGameAt ?? active.startedAt
  if (lastActivityAt + GAME_NIGHT_IDLE_TIMEOUT_MS > now) {
    return active
  }

  await c.get('deps').gameNights.complete(active.id, now)
  return null
}

async function requireRoomSession(
  c: RouteContext,
  roomId: RoomIdType,
): Promise<RoomSessionPayload | null> {
  const token = getCookie(c, ROOM_SESSION_COOKIE)
  if (!token) return null

  const payload = await verifyRoomSession(token, c.env.SESSION_SECRET)
  if (!payload) return null
  if (payload.roomId !== roomId) return null
  if (payload.exp <= Date.now()) return null
  return payload
}

async function requireActiveGameNight(
  c: RouteContext,
  roomId: RoomIdType,
  gameNightId: GameNightId,
): Promise<GameNight | null> {
  const activeGameNight = await getFreshActiveGameNight(c, roomId, Date.now())
  if (!activeGameNight) return null
  if (activeGameNight.id !== gameNightId) return null
  return activeGameNight
}

async function issueRoomSession(
  c: RouteContext,
  roomId: RoomIdType,
  now: number,
): Promise<RoomSessionPayload> {
  const exp = now + ROOM_SESSION_TTL_MS
  const token = await signRoomSession({ roomId, exp }, c.env.SESSION_SECRET)
  setCookie(c, ROOM_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    expires: new Date(exp),
    maxAge: Math.floor(ROOM_SESSION_TTL_MS / 1000),
  })
  return { roomId, exp }
}

async function resolveRoomByLookup(
  c: RouteContext,
  lookup: string,
): Promise<Room | null> {
  const roomById = await c.get('deps').rooms.get(RoomId(lookup))
  if (roomById) return roomById

  const nameKey = normalizeNameStem(lookup)
  if (!nameKey) return null
  return c.get('deps').rooms.getByNameKey(nameKey)
}

function resolveClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('cf-connecting-ip') ?? 'local'
}

function nextPinAttempt(
  roomId: RoomIdType,
  ip: string,
  attempt: PinAttempt | null,
  now: number,
): PinAttempt {
  const attempts = (attempt?.attempts ?? 0) + 1
  return {
    roomId,
    ip,
    attempts,
    lockedUntil: attempts >= 5 ? now + 60_000 * 2 ** (attempts - 5) : null,
  }
}

async function parseJson(c: RouteContext): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function dedupeGamerIds(ids: ReadonlyArray<string>): GamerId[] {
  return [...new Set(ids.map((id) => GamerId(id)))]
}

function validateManualGameSides(
  homeGamerIds: ReadonlyArray<GamerId>,
  awayGamerIds: ReadonlyArray<GamerId>,
  activeGameNightGamerIds: ReadonlySet<GamerId>,
): keyof typeof GAME_FORMATS {
  const duplicateIds = homeGamerIds.filter((gamerId) => awayGamerIds.includes(gamerId))
  if (duplicateIds.length > 0) {
    throw new Error(`duplicate_manual_gamers:${duplicateIds[0]}`)
  }

  for (const gamerId of [...homeGamerIds, ...awayGamerIds]) {
    if (!activeGameNightGamerIds.has(gamerId)) {
      throw new Error(`gamer_not_active_in_game_night:${gamerId}`)
    }
  }

  const format = inferGameFormat(homeGamerIds.length, awayGamerIds.length)
  if (!format) {
    throw new Error('invalid_manual_format')
  }

  return format
}
