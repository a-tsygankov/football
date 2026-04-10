import { nanoid } from 'nanoid'
import type {
  ILogger,
  LogCategory,
  LogContext,
  LogEntry,
  LogLevel,
} from '@fc26/shared/logger'

/**
 * Client logger with a bounded in-memory ring buffer. Subscribers (Console UI)
 * re-render on any push. A future iteration will mirror entries to IndexedDB
 * so they survive reloads; Phase 0 keeps it memory-only to avoid shipping an
 * async store before the Console needs one.
 */
const MAX_ENTRIES = 500

type Subscriber = (entries: ReadonlyArray<LogEntry>) => void

class ClientLogger implements ILogger {
  private entries: LogEntry[] = []
  private subscribers: Set<Subscriber> = new Set()
  private correlationId?: string

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
    const child = new ClientLogger()
    child.entries = this.entries
    child.subscribers = this.subscribers
    child.correlationId = correlationId
    return child
  }

  /** Merge Worker-originated entries returned in the response header. */
  mergeRemote(entries: ReadonlyArray<LogEntry>): void {
    if (entries.length === 0) return
    for (const entry of entries) this.appendEntry(entry)
    this.notify()
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    fn(this.entries)
    return () => this.subscribers.delete(fn)
  }

  snapshot(): ReadonlyArray<LogEntry> {
    return this.entries
  }

  clear(): void {
    this.entries = []
    this.notify()
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
      source: 'web',
      category,
      message,
      correlationId: this.correlationId,
      context,
    }
    this.appendEntry(entry)
    // Also mirror to browser devtools for direct debugging.
    const fn = level === 'debug' ? console.log : console[level]
    fn.call(console, `[${category}] ${message}`, context ?? '')
    this.notify()
  }

  private appendEntry(entry: LogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    }
  }

  private notify(): void {
    for (const fn of this.subscribers) fn(this.entries)
  }
}

export const logger = new ClientLogger()
