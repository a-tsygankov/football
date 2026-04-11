/**
 * Worker bindings and environment variables surfaced to route handlers.
 *
 * D1 and R2 bindings are commented out in wrangler.toml until Phase 1 of the
 * build — the Worker still boots without them so we can deploy a scaffold
 * that serves /api/version and /api/health today.
 */
export interface Env {
  readonly WORKER_VERSION: string
  readonly SCHEMA_VERSION: string
  readonly MIN_CLIENT_VERSION: string
  readonly SESSION_SECRET: string
  readonly GIT_SHA?: string

  // Added in Phase 1+
  readonly DB?: D1Database
  readonly SQUADS?: R2Bucket
}
