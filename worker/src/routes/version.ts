import { Hono } from 'hono'
import type { AppContext } from '../app.js'

export interface VersionResponse {
  workerVersion: string
  schemaVersion: number
  minClientVersion: string
  gitSha: string | null
  builtAt: string
  latestSquadVersion: string | null
}

/**
 * Three-axis version info surfaced to the client. The client calls this on
 * startup and refuses to continue if its version is below `minClientVersion`
 * (Phase 0 scaffold: banner only, no hard stop).
 */
export const versionRoutes = new Hono<AppContext>()

versionRoutes.get('/version', async (c) => {
  const env = c.env
  const latestSquadVersion = (await c.get('deps').squadVersions.latest())?.version ?? null
  const body: VersionResponse = {
    workerVersion: env.WORKER_VERSION,
    schemaVersion: Number.parseInt(env.SCHEMA_VERSION, 10),
    minClientVersion: env.MIN_CLIENT_VERSION,
    gitSha: env.GIT_SHA ?? null,
    builtAt: new Date().toISOString(),
    latestSquadVersion,
  }
  c.get('logger').info('system', 'version requested', { ...body })
  return c.json(body)
})
