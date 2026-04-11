import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CORRELATION_HEADER, LOG_HEADER } from '@fc26/shared/logger'
import type { Env } from './env.js'
import type { WorkerLogger } from './logger.js'
import { withLogger } from './middleware/logging.js'
import { buildDependencies, type AppDependencies } from './dependencies.js'
import { versionRoutes } from './routes/version.js'
import { healthRoutes } from './routes/health.js'
import { roomRoutes } from './routes/rooms.js'
import { squadRoutes } from './routes/squads.js'

/** Hono variables exposed to every route. */
export interface AppVariables {
  logger: WorkerLogger
  correlationId: string
  deps: AppDependencies
}

/** Type alias used by route modules so they pick up the same shape. */
export type AppContext = { Bindings: Env; Variables: AppVariables }

/**
 * Builds the Hono app. Extracted from the Worker fetch handler so the same
 * graph can be imported by tests without touching the Cloudflare runtime.
 *
 * Tests can pass a `dependencies` factory to inject in-memory fakes; in
 * production, dependencies are derived from the request `Env` on each call.
 */
export interface BuildAppOptions {
  /** Override the dependency graph. Tests pass in-memory fakes here. */
  readonly dependencies?: (env: Env) => AppDependencies
}

export function buildApp(options: BuildAppOptions = {}): Hono<AppContext> {
  const buildDeps = options.dependencies ?? buildDependencies
  const app = new Hono<AppContext>()

  app.use(
    '*',
    cors({
      origin: (origin) => origin,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', CORRELATION_HEADER],
      exposeHeaders: [LOG_HEADER],
      credentials: true,
      maxAge: 86_400,
    }),
  )

  app.use('*', withLogger())

  app.use('*', async (c, next) => {
    c.set('deps', buildDeps(c.env))
    await next()
  })

  app.route('/api', versionRoutes)
  app.route('/api', healthRoutes)
  app.route('/api', roomRoutes)
  app.route('/api', squadRoutes)

  app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404))

  app.onError((err, c) => {
    c.get('logger').error('system', 'unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json({ error: 'internal_error' }, 500)
  })

  return app
}
