import { Hono } from 'hono'
import type { SquadSyncResult } from '@fc26/shared'
import type { AppContext } from '../app.js'
import { resolveSquadSyncConfig } from '../squad/sync-config.js'
import { SquadSyncService } from '../squad/sync-service.js'

const SQUAD_SYNC_SECRET_HEADER = 'x-squad-sync-secret'

export const squadSyncRoutes = new Hono<AppContext>()

squadSyncRoutes.post('/internal/squads/sync', async (c) => {
  const configuredSecret = c.env.SQUAD_SYNC_ADMIN_SECRET?.trim()
  if (!configuredSecret) {
    return c.json({ error: 'squad_sync_secret_not_configured' }, 503)
  }
  const providedSecret = c.req.header(SQUAD_SYNC_SECRET_HEADER)?.trim()
  if (!providedSecret || providedSecret !== configuredSecret) {
    c.get('logger').warn('auth', 'squad sync rejected', {
      reason: 'invalid_secret',
    })
    return c.json({ error: 'unauthorized' }, 401)
  }

  const service = new SquadSyncService({
    config: resolveSquadSyncConfig(c.env),
    fetchImpl: fetch,
    logger: c.get('logger'),
    now: () => Date.now(),
    squadStorage: c.get('deps').squadStorage,
    squadVersions: c.get('deps').squadVersions,
  })

  let result: SquadSyncResult
  try {
    result = await service.syncLatest()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    c.get('logger').error('squad-sync', 'internal squad sync failed', {
      error: message,
    })
    return c.json(
      {
        error: 'squad_sync_failed',
        message,
      },
      502,
    )
  }
  return c.json(result)
})

export { SQUAD_SYNC_SECRET_HEADER }
