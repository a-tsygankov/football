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
const API_BASE = (import.meta.env.VITE_API_BASE ?? '') as string
const ROOM_SESSION_STORAGE_KEY = 'fc26:last-room-session'

/**
 * Resolve an `<img src>` value coming from the worker.
 *
 * The asset refresh service writes worker-relative paths (e.g.
 * `/api/squads/logos/123`) into `Club.logoUrl` once a logo has been cached
 * to R2. The browser would resolve those against its own origin (github.io
 * in production), so we prepend `API_BASE` for any path that starts with
 * `/api/`. Absolute URLs (legacy SportsDB CDN) and `data:` URIs pass through
 * unchanged.
 */
export function resolveAssetUrl(value: string | null | undefined): string | null | undefined {
  if (!value) return value
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
