import type { Env } from './env.js'
import { InMemorySquadStorage } from './squad/in-memory-storage.js'
import { R2SquadStorage } from './squad/r2-storage.js'
import {
  D1SquadVersionRepository,
  InMemorySquadVersionRepository,
  type ISquadVersionRepository,
} from './squad/version-repository.js'
import type { ISquadStorage } from './squad/storage.js'

/**
 * The composition root for Worker dependencies.
 *
 * Routes never construct R2/D1 directly. They get an `AppDependencies` from
 * the Hono context, populated by `buildApp()` from the env on every request
 * (or by tests with in-memory fakes).
 */
export interface AppDependencies {
  readonly squadStorage: ISquadStorage
  readonly squadVersions: ISquadVersionRepository
}

/**
 * Builds the production dependency graph from a Worker `Env`. Falls back to
 * in-memory implementations when bindings are not configured (Phase 0 boot,
 * or when the developer is running `wrangler dev` without R2/D1 set up).
 *
 * The fallbacks let the scaffold respond to `/api/version` and `/api/health`
 * without erroring; they're never used in production where bindings exist.
 */
export function buildDependencies(env: Env): AppDependencies {
  return {
    squadStorage: env.SQUADS
      ? new R2SquadStorage(env.SQUADS)
      : new InMemorySquadStorage(),
    squadVersions: env.DB
      ? new D1SquadVersionRepository(env.DB)
      : new InMemorySquadVersionRepository(),
  }
}
