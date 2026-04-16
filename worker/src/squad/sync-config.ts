import { DEFAULT_SQUAD_PLATFORM, type SquadPlatform } from '@fc26/shared'
import { SQUAD_APP_CONFIG } from '../config/squad.js'

export const DEFAULT_SQUAD_RETENTION_COUNT = 12
export const DEFAULT_EA_ROSTERUPDATE_URL =
  'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml'

export type SquadSyncSourceKind =
  | 'json-snapshot'
  | 'ea-rosterupdate-json'
  | 'ea-rosterupdate-binary'

export interface JsonSnapshotSquadSyncConfig {
  readonly sourceKind: 'json-snapshot'
  readonly sourceUrl: string
  readonly retentionCount: number
}

export interface EaRosterupdateJsonSquadSyncConfig {
  readonly sourceKind: 'ea-rosterupdate-json'
  readonly discoveryUrl: string
  readonly snapshotUrlTemplate: string
  readonly platform: SquadPlatform
  readonly retentionCount: number
}

/**
 * Reads the EA roster binary directly from the location advertised in the
 * roster discovery XML. Same flow the local EA preview uses, just in the
 * worker. No external snapshot host required.
 */
export interface EaRosterupdateBinarySquadSyncConfig {
  readonly sourceKind: 'ea-rosterupdate-binary'
  readonly discoveryUrl: string
  readonly platform: SquadPlatform
  readonly retentionCount: number
}

export type SquadSyncConfig =
  | JsonSnapshotSquadSyncConfig
  | EaRosterupdateJsonSquadSyncConfig
  | EaRosterupdateBinarySquadSyncConfig

export function resolveSquadSyncConfig(
  overrides: {
    platform?: SquadPlatform
  } = {},
): SquadSyncConfig | null {
  const retentionCount = resolveRetentionCount(SQUAD_APP_CONFIG.sync.retentionCount)
  const sourceKind = SQUAD_APP_CONFIG.sync.sourceKind
  if (!sourceKind) return null

  if (sourceKind === 'json-snapshot') {
    const sourceUrl = SQUAD_APP_CONFIG.sync.sourceUrl.trim()
    if (!sourceUrl) return null
    return {
      sourceKind,
      sourceUrl,
      retentionCount,
    }
  }

  if (sourceKind === 'ea-rosterupdate-json') {
    const snapshotUrlTemplate = SQUAD_APP_CONFIG.sync.snapshotUrlTemplate.trim()
    if (!snapshotUrlTemplate) return null
    return {
      sourceKind,
      discoveryUrl:
        SQUAD_APP_CONFIG.sync.discoveryUrl.trim() || DEFAULT_EA_ROSTERUPDATE_URL,
      snapshotUrlTemplate,
      platform: overrides.platform ?? resolvePlatform(SQUAD_APP_CONFIG.sync.defaultPlatform),
      retentionCount,
    }
  }

  if (sourceKind === 'ea-rosterupdate-binary') {
    return {
      sourceKind,
      discoveryUrl:
        SQUAD_APP_CONFIG.sync.discoveryUrl.trim() || DEFAULT_EA_ROSTERUPDATE_URL,
      platform: overrides.platform ?? resolvePlatform(SQUAD_APP_CONFIG.sync.defaultPlatform),
      retentionCount,
    }
  }

  return null
}

function resolveRetentionCount(raw: string | number | undefined): number {
  const normalized = typeof raw === 'number' ? String(raw) : raw
  const parsed = normalized ? Number.parseInt(normalized, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SQUAD_RETENTION_COUNT
  return parsed
}

function resolvePlatform(raw: string | undefined): SquadPlatform {
  const value = raw?.trim().toUpperCase()
  if (value === 'PC64' || value === 'XBSX' || value === 'PS5') {
    return value
  }
  return DEFAULT_SQUAD_PLATFORM
}
