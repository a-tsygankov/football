import { buildApp } from './app.js'
import { buildDependencies } from './dependencies.js'
import type { Env } from './env.js'
import { WorkerLogger } from './logger.js'
import { resolveSquadSyncConfig } from './squad/sync-config.js'
import { SquadSyncService } from './squad/sync-service.js'

const app = buildApp()

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, env, ctx)
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledSquadSync(env))
  },
} satisfies ExportedHandler<Env>

async function runScheduledSquadSync(env: Env): Promise<void> {
  const logger = new WorkerLogger(`cron-squad-sync-${Date.now()}`)
  const deps = buildDependencies(env)
  const service = new SquadSyncService({
    config: resolveSquadSyncConfig(),
    fetchImpl: fetch,
    logger,
    now: () => Date.now(),
    squadStorage: deps.squadStorage,
    squadVersions: deps.squadVersions,
  })
  await service.syncLatest()
}
