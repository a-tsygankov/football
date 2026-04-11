import { nanoid } from 'nanoid'
import {
  type CreateGamerRequest,
  type CreateRoomRequest,
  DEFAULT_STRATEGY_ID,
  type GameNight,
  GameNightId,
  type GameNightActiveGamer,
  GamerId,
  getStrategy,
  type JoinRoomRequest,
  type Room,
  type RoomBootstrapResponse,
  RoomId,
  type RoomId as RoomIdType,
  type UpdateGamerRequest,
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

const GAME_NIGHT_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000
type RouteContext = Context<AppContext>

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pin: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  defaultSelectionStrategy: z.string().trim().min(1).max(64).optional(),
})

const joinRoomSchema = z.object({
  pin: z.string().nullable().optional(),
})

const createGamerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rating: z.number().int().min(1).max(5).optional(),
  active: z.boolean().optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const updateGamerSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  active: z.boolean().optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const createGameNightSchema = z.object({
  activeGamerIds: z.array(z.string().min(1)).optional(),
})

export const roomRoutes = new Hono<AppContext>()

roomRoutes.post('/rooms', async (c) => {
  const parsed = createRoomSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const body = parsed.data satisfies CreateRoomRequest
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
  const roomId = RoomId(c.req.param('roomId'))
  const parsed = joinRoomSchema.safeParse(await parseJson(c))
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.flatten() }, 400)
  }

  const room = await c.get('deps').rooms.get(roomId)
  if (!room) return c.json({ error: 'not_found', roomId }, 404)

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
  const now = Date.now()
  const gamer = {
    id: GamerId(nanoid(10)),
    roomId,
    name: body.name.trim(),
    rating: body.rating ?? 3,
    active: body.active ?? true,
    avatarUrl: body.avatarUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }

  await c.get('deps').gamers.insert(gamer)
  return c.json({ gamer }, 201)
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
  if (body.active === false) {
    const activeGameNight = await getFreshActiveGameNight(c, roomId, Date.now())
    if (activeGameNight) {
      const activeGamers = await c.get('deps').gameNights.listActiveGamers(activeGameNight.id)
      if (activeGamers.some((activeGamer) => activeGamer.gamerId === gamerId)) {
        return c.json({ error: 'gamer_active_in_game_night', gamerId }, 409)
      }
    }
  }

  const updated = {
    ...existing,
    name: body.name?.trim() ?? existing.name,
    rating: body.rating ?? existing.rating,
    active: body.active ?? existing.active,
    avatarUrl: body.avatarUrl !== undefined ? body.avatarUrl : existing.avatarUrl,
    updatedAt: Date.now(),
  }

  await c.get('deps').gamers.update(updated)
  return c.json({ gamer: updated })
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

  return {
    room: toRoomSummary(room),
    gamers: await c.get('deps').gamers.listByRoom(roomId),
    activeGameNight,
    activeGameNightGamers,
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
