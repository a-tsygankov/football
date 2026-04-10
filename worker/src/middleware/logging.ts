import type { MiddlewareHandler } from 'hono'
import { LOG_HEADER, WorkerLogger, resolveCorrelationId } from '../logger.js'

/**
 * Hono middleware that:
 *  - Creates a per-request WorkerLogger and puts it on the context.
 *  - Logs the start and end of every request.
 *  - Serialises collected entries onto the x-fc26-logs response header.
 */
export function withLogger(): MiddlewareHandler<{
  Variables: { logger: WorkerLogger; correlationId: string }
}> {
  return async (c, next) => {
    const correlationId = resolveCorrelationId(c.req.raw)
    const logger = new WorkerLogger(correlationId, {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    })
    c.set('logger', logger)
    c.set('correlationId', correlationId)

    const start = Date.now()
    logger.info('http', 'request received')

    try {
      await next()
      logger.info('http', 'request completed', {
        status: c.res.status,
        durationMs: Date.now() - start,
      })
    } catch (err) {
      logger.error('http', 'request failed', {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      })
      throw err
    } finally {
      c.res.headers.set(LOG_HEADER, logger.serializeForHeader())
    }
  }
}
