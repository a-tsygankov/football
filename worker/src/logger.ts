import { nanoid } from 'nanoid'
import {
  CORRELATION_HEADER,
  LOG_HEADER,
  LOG_HEADER_MAX_BYTES,
  type ILogger,
  type LogCategory,
  type LogContext,
  type LogEntry,
  type LogHeaderPayload,
  type LogLevel,
} from '@fc26/shared/logger'

/**
 * Per-request log collector. One instance is created per request by
 * `withLogger` middleware and attached to the Hono context. When the request
 * finishes, the middleware serialises entries onto the response header if
 * they fit, otherwise signals the client to fetch the full payload lazily via
 * GET /api/logs?correlationId=...
 *
 * Note: overflow retrieval is a Phase 5 deliverable (needs D1). Until then we
 * simply truncate with a warning.
 */
export class WorkerLogger implements ILogger {
  readonly entries: LogEntry[] = []

  constructor(
    readonly correlationId: string,
    private readonly baseContext: LogContext = {},
  ) {}

  debug(category: LogCategory, message: string, context?: LogContext): void {
    this.push('debug', category, message, context)
  }
  info(category: LogCategory, message: string, context?: LogContext): void {
    this.push('info', category, message, context)
  }
  warn(category: LogCategory, message: string, context?: LogContext): void {
    this.push('warn', category, message, context)
  }
  error(category: LogCategory, message: string, context?: LogContext): void {
    this.push('error', category, message, context)
  }

  withCorrelation(correlationId: string): ILogger {
    return new WorkerLogger(correlationId, this.baseContext)
  }

  private push(
    level: LogLevel,
    category: LogCategory,
    message: string,
    context?: LogContext,
  ): void {
    const entry: LogEntry = {
      id: nanoid(),
      ts: new Date().toISOString(),
      level,
      source: 'worker',
      category,
      message,
      correlationId: this.correlationId,
      context: { ...this.baseContext, ...context },
    }
    this.entries.push(entry)
    // Also stream to Cloudflare Logs so they're visible in `wrangler tail`.
    const payload = { ...entry }
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](JSON.stringify(payload))
  }

  serializeForHeader(): string {
    const fullPayload: LogHeaderPayload = {
      truncated: false,
      correlationId: this.correlationId,
      entries: this.entries,
    }
    const full = btoa(JSON.stringify(fullPayload))
    if (full.length <= LOG_HEADER_MAX_BYTES) return full

    const truncatedPayload: LogHeaderPayload = {
      truncated: true,
      correlationId: this.correlationId,
      entries: [],
    }
    return btoa(JSON.stringify(truncatedPayload))
  }
}

/** Read or generate the correlation ID for a request. */
export function resolveCorrelationId(req: Request): string {
  return req.headers.get(CORRELATION_HEADER) ?? nanoid()
}

export { LOG_HEADER }
