/**
 * Cross-cutting log contract shared by web and worker.
 *
 * Both runtimes implement their own ILogger:
 *  - Web: ring buffer (memory + IndexedDB mirror) shown in the hidden Console.
 *  - Worker: per-request collector that ships entries back via response header
 *    or on-demand via GET /api/logs?correlationId=...
 *
 * Keep this file dependency-free so it imports cheaply on both sides.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogSource = 'web' | 'worker'

/**
 * Loose context shape for log entries. Accepts any object whose values are
 * JSON-serialisable. Using `object` rather than `Record<string, unknown>` so
 * callers can pass strongly-typed DTOs without a cast.
 */
export type LogContext = Record<string, unknown> | object

export type LogCategory =
  | 'game'
  | 'db'
  | 'http'
  | 'system'
  | 'squad-sync'
  | 'auth'
  | 'selection'
  | 'projection'
  | 'ocr'

export interface LogEntry {
  id: string
  /** ISO 8601 UTC. */
  ts: string
  level: LogLevel
  source: LogSource
  category: LogCategory
  message: string
  context?: LogContext
  /** Ties web → worker log entries together for a single API call. */
  correlationId?: string
}

export interface ILogger {
  debug(category: LogCategory, message: string, context?: LogContext): void
  info(category: LogCategory, message: string, context?: LogContext): void
  warn(category: LogCategory, message: string, context?: LogContext): void
  error(category: LogCategory, message: string, context?: LogContext): void
  /** Returns a child logger that stamps every entry with the given correlation ID. */
  withCorrelation(correlationId: string): ILogger
}

/** Header used to ship Worker log entries back to the client in-band. */
export const LOG_HEADER = 'x-fc26-logs'

/** Header used by the client to assign a correlation ID to a request. */
export const CORRELATION_HEADER = 'x-correlation-id'

/** Max bytes we'll inline into the response header before falling back to /api/logs. */
export const LOG_HEADER_MAX_BYTES = 8 * 1024

export interface LogHeaderPayload {
  /** When true, the client should fetch the full set lazily via /api/logs. */
  truncated: boolean
  correlationId: string
  entries: readonly LogEntry[]
}
