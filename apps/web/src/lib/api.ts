import { nanoid } from 'nanoid'
import {
  ROOM_SESSION_HEADER,
  type RoomSessionInfo,
} from '@fc26/shared'
import {
  CORRELATION_HEADER,
  LOG_HEADER,
  type LogHeaderPayload,
} from '@fc26/shared/logger'
import { logger } from './logger.js'

/**
 * Thin fetch wrapper that:
 *  - Tags every outgoing request with a correlation ID.
 *  - Drains the x-fc26-logs response header and merges entries into the
 *    client logger so Worker logs appear in the hidden Console.
 */
/**
 * Empty in production, and that is correct: the client Worker proxies /api/*
 * to the API Worker over a service binding, so the client is same-origin.
 * Dev is same-origin too — vite proxies /api to the local wrangler.
 *
 * VITE_API_BASE remains readable as an escape hatch (pointing a local build at
 * a deployed API, say). It used to be required in production, and an unset
 * value silently produced a client that called its own origin and 404'd on
 * every request.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '') as string
const ROOM_SESSION_STORAGE_KEY = 'fc26:last-room-session'

/**
 * Resolve an `<img src>` value coming from the worker.
 *
 * The asset refresh service writes worker-relative paths (e.g.
 * `/api/squads/logos/123`) into `Club.logoUrl` once a logo has been cached
 * to R2. Prepending `API_BASE` is now a no-op in production — same origin —
 * but is kept for builds that point at a different API. Absolute URLs (legacy
 * SportsDB CDN) and `data:` URIs pass through unchanged.
 *
 * Squad ingest writes a `pending:club:{id}` sentinel into `Club.logoUrl` to
 * satisfy the shared schema's `min(1)` invariant until the asset refresh
 * service backfills a real URL. We rewrite the sentinel to the worker logo
 * route (`/api/squads/logos/{id}`) so `<img>` always has something to load
 * — the route serves cached badge bytes when a Refresh has succeeded, and a
 * deterministic generated SVG (initials on a hashed colour) otherwise. That
 * way the UI is never blank while waiting for the optional logo refresh.
 */
export function resolveAssetUrl(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  if (value.startsWith('pending:club:')) {
    const clubId = value.slice('pending:club:'.length)
    return `${API_BASE}/api/squads/logos/${clubId}`
  }
  if (value.startsWith('pending:')) return null
  if (value.startsWith('/api/')) return `${API_BASE}${value}`
  return value
}

export interface ApiError extends Error {
  status: number
  code?: string
}

interface StoredRoomSession {
  roomId: string
  token: string
  expiresAt: number
}

export function persistRoomSession(session: RoomSessionInfo): void {
  if (typeof localStorage === 'undefined') return
  if (!session.token) return
  localStorage.setItem(
    ROOM_SESSION_STORAGE_KEY,
    JSON.stringify({
      roomId: session.roomId,
      token: session.token,
      expiresAt: session.expiresAt,
    } satisfies StoredRoomSession),
  )
}

export function clearPersistedRoomSession(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(ROOM_SESSION_STORAGE_KEY)
}

function readPersistedRoomSession(): StoredRoomSession | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(ROOM_SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRoomSession>
    if (
      typeof parsed.roomId !== 'string' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      clearPersistedRoomSession()
      return null
    }
    if (parsed.expiresAt <= Date.now()) {
      clearPersistedRoomSession()
      return null
    }
    return parsed as StoredRoomSession
  } catch {
    clearPersistedRoomSession()
    return null
  }
}

function matchRoomIdFromPath(path: string): string | null {
  const matched = /^\/api\/rooms\/([^/]+)/.exec(path)
  return matched?.[1] ?? null
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const correlationId = nanoid()
  const headers = new Headers(init.headers ?? {})
  headers.set(CORRELATION_HEADER, correlationId)
  const roomId = matchRoomIdFromPath(path)
  const persistedSession = readPersistedRoomSession()
  if (roomId && persistedSession?.roomId === roomId) {
    headers.set(ROOM_SESSION_HEADER, persistedSession.token)
  }

  logger.debug('http', `→ ${init.method ?? 'GET'} ${path}`, { correlationId })

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })

  const logHeader = res.headers.get(LOG_HEADER)
  if (logHeader) {
    try {
      const payload = JSON.parse(atob(logHeader)) as LogHeaderPayload
      if (payload.truncated) {
        logger.warn('http', 'worker log payload truncated', { correlationId })
      } else {
        logger.mergeRemote(payload.entries)
      }
    } catch (err) {
      logger.warn('http', 'failed to parse log header', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.debug('http', `← ${res.status} ${path}`, { correlationId })
  return res
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    let message = `API ${res.status} ${path}`
    let code: string | undefined
    try {
      const payload = (await res.json()) as { error?: string; message?: string }
      code = payload.error
      message = payload.message ?? payload.error ?? message
    } catch {
      // Ignore parse failures and keep the generic message.
    }
    const err = new Error(message) as ApiError
    err.status = res.status
    err.code = code
    throw err
  }
  return (await res.json()) as T
}

const LAST_BETTOR_KEY = 'fc26:last-bettor'

/**
 * The gamer who last bet from this device, per room. Defaults the picker so a
 * shared phone saves a tap and a stale name is less likely to be left
 * selected by the previous bettor.
 */
export function readLastBettor(roomId: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_BETTOR_KEY}:${roomId}`)
  } catch {
    return null
  }
}

export function persistLastBettor(roomId: string, gamerId: string): void {
  try {
    window.localStorage.setItem(`${LAST_BETTOR_KEY}:${roomId}`, gamerId)
  } catch {
    // Private-mode Safari throws on localStorage writes. The default is a
    // convenience, so losing it is not worth surfacing.
  }
}
