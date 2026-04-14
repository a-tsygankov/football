import { Hono } from 'hono'
import type { SquadSyncResult } from '@fc26/shared'
import type { AppContext } from '../app.js'
import { resolveSquadSyncConfig } from '../squad/sync-config.js'
import { SquadSyncService } from '../squad/sync-service.js'

const SQUAD_SYNC_SECRET_HEADER = 'x-squad-sync-secret'

function getFetchImpl(): typeof fetch {
  return globalThis.fetch.bind(globalThis)
}

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

  const config = resolveSquadSyncConfig()
  c.get('logger').info('squad-sync', 'internal squad sync requested', {
    hasDbBinding: Boolean(c.env.DB),
    hasSquadsBinding: Boolean(c.env.SQUADS),
    ...summarizeSquadSyncConfig(config),
  })

  const service = new SquadSyncService({
    config,
    fetchImpl: getFetchImpl(),
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
    c.get('logger').error('squad-sync', `internal squad sync failed: ${message}`, {
      hasDbBinding: Boolean(c.env.DB),
      hasSquadsBinding: Boolean(c.env.SQUADS),
      ...summarizeSquadSyncConfig(config),
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

function summarizeSquadSyncConfig(
  config: ReturnType<typeof resolveSquadSyncConfig>,
): Record<string, unknown> {
  if (!config) {
    return { sourceKind: null }
  }
  switch (config.sourceKind) {
    case 'json-snapshot':
      return {
        sourceKind: config.sourceKind,
        sourceUrl: config.sourceUrl,
      }
    case 'ea-rosterupdate-json':
      return {
        sourceKind: config.sourceKind,
        discoveryUrl: config.discoveryUrl,
        snapshotUrlTemplate: config.snapshotUrlTemplate,
        platform: config.platform,
      }
  }
}
