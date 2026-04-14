import type { Env } from '../env.js'

export const DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL =
  'https://www.thesportsdb.com/api/v1/json/123'

export interface SquadAssetRefreshConfig {
  readonly providerBaseUrl: string
  readonly leagueAliases: Readonly<Record<string, string>>
}

export function resolveSquadAssetRefreshConfig(env: Env): SquadAssetRefreshConfig {
  return {
    providerBaseUrl:
      env.SQUAD_ASSET_PROVIDER_BASE_URL?.trim() || DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL,
    leagueAliases: parseLeagueAliases(env.SQUAD_ASSET_LEAGUE_ALIASES_JSON),
  }
}

function parseLeagueAliases(raw: string | undefined): Readonly<Record<string, string>> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string' && key.trim() && value.trim()) {
        next[key.trim()] = value.trim()
      }
    }
    return next
  } catch {
    return {}
  }
}
