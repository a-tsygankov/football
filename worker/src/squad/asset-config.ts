export const DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL =
  'https://www.thesportsdb.com/api/v1/json/123'

export interface SquadAssetRefreshConfig {
  readonly providerBaseUrl: string
  readonly leagueAliases: Readonly<Record<string, string>>
}

export function resolveSquadAssetRefreshConfig(input: {
  providerBaseUrl: string
  leagueAliases: Readonly<Record<string, string>>
}): SquadAssetRefreshConfig {
  return {
    providerBaseUrl: input.providerBaseUrl.trim() || DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL,
    leagueAliases: sanitizeLeagueAliases(input.leagueAliases),
  }
}

function sanitizeLeagueAliases(
  aliases: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(aliases)) {
    if (typeof key === 'string' && typeof value === 'string' && key.trim() && value.trim()) {
      next[key.trim()] = value.trim()
    }
  }
  return next
}
