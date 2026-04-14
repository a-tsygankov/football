import type { Env } from '../env.js'

export const DEFAULT_SQUAD_RETENTION_COUNT = 12
export const DEFAULT_EA_ROSTERUPDATE_URL =
  'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml'

export type SquadSyncSourceKind =
  | 'json-snapshot'
  | 'ea-rosterupdate-json'
  | 'github-release-json'

export interface JsonSnapshotSquadSyncConfig {
  readonly sourceKind: 'json-snapshot'
  readonly sourceUrl: string
  readonly retentionCount: number
}

export interface EaRosterupdateJsonSquadSyncConfig {
  readonly sourceKind: 'ea-rosterupdate-json'
  readonly discoveryUrl: string
  readonly snapshotUrlTemplate: string
  readonly platform: string
  readonly retentionCount: number
}

export interface GitHubReleaseJsonSquadSyncConfig {
  readonly sourceKind: 'github-release-json'
  readonly repository: string
  readonly assetName: string
  readonly token: string | null
  readonly retentionCount: number
}

export type SquadSyncConfig =
  | JsonSnapshotSquadSyncConfig
  | EaRosterupdateJsonSquadSyncConfig
  | GitHubReleaseJsonSquadSyncConfig

export function resolveSquadSyncConfig(env: Env): SquadSyncConfig | null {
  const retentionCount = resolveRetentionCount(env.SQUAD_SYNC_RETENTION_COUNT)
  const explicitKind = env.SQUAD_SYNC_SOURCE_KIND
  const inferredKind = inferSourceKind(env)
  const sourceKind = explicitKind ?? inferredKind
  if (!sourceKind) return null

  if (sourceKind === 'json-snapshot') {
    const sourceUrl = env.SQUAD_SYNC_SOURCE_URL?.trim()
    if (!sourceUrl) return null
    return {
      sourceKind,
      sourceUrl,
      retentionCount,
    }
  }

  if (sourceKind === 'ea-rosterupdate-json') {
    const snapshotUrlTemplate = env.SQUAD_SYNC_SNAPSHOT_URL_TEMPLATE?.trim()
    if (!snapshotUrlTemplate) return null
    return {
      sourceKind,
      discoveryUrl: env.SQUAD_SYNC_DISCOVERY_URL?.trim() || DEFAULT_EA_ROSTERUPDATE_URL,
      snapshotUrlTemplate,
      platform: env.SQUAD_SYNC_PLATFORM?.trim() || 'PC64',
      retentionCount,
    }
  }

  if (sourceKind === 'github-release-json') {
    const repository = env.SQUAD_SYNC_GITHUB_REPOSITORY?.trim()
    const assetName = env.SQUAD_SYNC_GITHUB_ASSET_NAME?.trim()
    if (!repository || !assetName) return null
    return {
      sourceKind,
      repository,
      assetName,
      token: env.SQUAD_SYNC_GITHUB_TOKEN?.trim() || null,
      retentionCount,
    }
  }

  return null
}

function resolveRetentionCount(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SQUAD_RETENTION_COUNT
  return parsed
}

function inferSourceKind(env: Env): SquadSyncSourceKind | null {
  if (env.SQUAD_SYNC_SOURCE_URL?.trim()) return 'json-snapshot'
  if (env.SQUAD_SYNC_SNAPSHOT_URL_TEMPLATE?.trim()) return 'ea-rosterupdate-json'
  if (env.SQUAD_SYNC_GITHUB_REPOSITORY?.trim()) return 'github-release-json'
  return null
}
