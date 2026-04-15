export const DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL =
  'https://www.thesportsdb.com/api/v1/json/123'

/**
 * Wikipedia REST API base. Used as a secondary logo source when SportsDB
 * doesn't match a club — the article's `originalimage` tends to be the club
 * crest for most senior football sides. Wikipedia rate-limits per-IP but its
 * budget is far more generous than SportsDB's free tier, so it makes a good
 * backstop.
 */
export const DEFAULT_WIKIPEDIA_REST_BASE_URL =
  'https://en.wikipedia.org/api/rest_v1'

export interface SquadAssetRefreshConfig {
  readonly providerBaseUrl: string
  readonly leagueAliases: Readonly<Record<string, string>>
  /**
   * Wikipedia REST API base. Optional — callers that don't opt in (e.g.
   * tests that only exercise the SportsDB path) can leave it unset and the
   * service will use {@link DEFAULT_WIKIPEDIA_REST_BASE_URL}.
   */
  readonly wikipediaBaseUrl?: string
}

export function resolveSquadAssetRefreshConfig(input: {
  providerBaseUrl: string
  leagueAliases: Readonly<Record<string, string>>
  wikipediaBaseUrl?: string
}): SquadAssetRefreshConfig {
  return {
    providerBaseUrl: input.providerBaseUrl.trim() || DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL,
    leagueAliases: sanitizeLeagueAliases(input.leagueAliases),
    wikipediaBaseUrl:
      (input.wikipediaBaseUrl ?? '').trim() || DEFAULT_WIKIPEDIA_REST_BASE_URL,
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
