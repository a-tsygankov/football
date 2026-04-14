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
  readonly SQUAD_SYNC_SOURCE_KIND?:
    | 'json-snapshot'
    | 'ea-rosterupdate-json'
    | 'github-release-json'
  readonly SQUAD_SYNC_SOURCE_URL?: string
  readonly SQUAD_SYNC_DISCOVERY_URL?: string
  readonly SQUAD_SYNC_SNAPSHOT_URL_TEMPLATE?: string
  readonly SQUAD_SYNC_PLATFORM?: string
  readonly SQUAD_SYNC_GITHUB_REPOSITORY?: string
  readonly SQUAD_SYNC_GITHUB_ASSET_NAME?: string
  readonly SQUAD_SYNC_GITHUB_TOKEN?: string
  readonly SQUAD_SYNC_RETENTION_COUNT?: string
  readonly SQUAD_SYNC_ADMIN_SECRET?: string
  readonly SQUAD_ASSET_PROVIDER_BASE_URL?: string
  readonly SQUAD_ASSET_LEAGUE_ALIASES_JSON?: string

  // Added in Phase 1+
  readonly DB?: D1Database
  readonly SQUADS?: R2Bucket
}
