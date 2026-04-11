import { nanoid } from 'nanoid'
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

export interface ApiError extends Error {
  status: number
  code?: string
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const correlationId = nanoid()
  const headers = new Headers(init.headers ?? {})
  headers.set(CORRELATION_HEADER, correlationId)

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
