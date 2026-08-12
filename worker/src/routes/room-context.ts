import {
  type GameNight,
  type GameNightId,
  ROOM_SESSION_HEADER,
  type RoomId as RoomIdType,
} from '@fc26/shared'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppContext } from '../app.js'
import {
  ROOM_SESSION_COOKIE,
  type RoomSessionPayload,
  verifyRoomSession,
} from '../auth/session.js'

/** A game night with no games for this long is treated as finished. */
export const GAME_NIGHT_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000

export type RouteContext = Context<AppContext>

export interface ResolvedRoomSession extends RoomSessionPayload {
  token: string
  source: 'cookie' | 'header'
}

export async function getFreshActiveGameNight(
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

export async function requireRoomSession(
  c: RouteContext,
  roomId: RoomIdType,
): Promise<ResolvedRoomSession | null> {
  const headerToken = c.req.header(ROOM_SESSION_HEADER)
  const cookieToken = getCookie(c, ROOM_SESSION_COOKIE)
  const token = headerToken ?? cookieToken
  const source = headerToken ? 'header' : 'cookie'

  if (!token) {
    c.get('logger').warn('auth', 'room session missing', { roomId })
    return null
  }

  const payload = await verifyRoomSession(token, c.env.SESSION_SECRET)
  if (!payload) {
    c.get('logger').warn('auth', 'room session invalid', { roomId, source })
    return null
  }
  if (payload.roomId !== roomId) {
    c.get('logger').warn('auth', 'room session room mismatch', {
      roomId,
      source,
      tokenRoomId: payload.roomId,
    })
    return null
  }
  if (payload.exp <= Date.now()) {
    c.get('logger').warn('auth', 'room session expired', {
      roomId,
      source,
      expiresAt: payload.exp,
    })
    return null
  }
  return { ...payload, token, source }
}

export async function requireActiveGameNight(
  c: RouteContext,
  roomId: RoomIdType,
  gameNightId: GameNightId,
): Promise<GameNight | null> {
  const activeGameNight = await getFreshActiveGameNight(c, roomId, Date.now())
  if (!activeGameNight) return null
  if (activeGameNight.id !== gameNightId) return null
  return activeGameNight
}

export async function parseJson(c: RouteContext): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
