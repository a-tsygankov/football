export const DEFAULT_SQUAD_ASSET_PROVIDER_BASE_URL =
  'https://www.thesportsdb.com/api/v1/json/123'

/**
 * EA FUT Web App CDN. These serve the same club/league/nation IDs that come
 * out of the roster binary, so no fuzzy name matching is needed — just
 * substitute the numeric ID into the URL template.
 *
 * Club badges use the FC 26 GUID + year 2026 with the `dark` variant.
 * League logos are only available on the legacy GUID from FC 24.
 * Nation flags use the FC 26 GUID.
 */
export const EA_CDN_CLUB_BADGE_URL_TEMPLATE =
  'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/clubs/dark/{clubId}.png'

export const EA_CDN_LEAGUE_LOGO_URL_TEMPLATE =
  'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/24B23FDE-7835-41C2-87A2-F453DFDB2E82/2024/fut/items/images/mobile/leagueLogos/dark/{leagueId}.png'

export const EA_CDN_FLAG_URL_TEMPLATE =
  'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/flags/dark/{nationId}.png'

export function eaCdnClubBadgeUrl(clubId: number): string {
  return EA_CDN_CLUB_BADGE_URL_TEMPLATE.replace('{clubId}', String(clubId))
}

export function eaCdnLeagueLogoUrl(leagueId: number): string {
  return EA_CDN_LEAGUE_LOGO_URL_TEMPLATE.replace('{leagueId}', String(leagueId))
}

export function eaCdnFlagUrl(nationId: number): string {
  return EA_CDN_FLAG_URL_TEMPLATE.replace('{nationId}', String(nationId))
}

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
