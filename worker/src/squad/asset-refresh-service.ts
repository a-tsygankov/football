import type { Club, ILogger, SquadAssetRefreshResult } from '@fc26/shared'
import { isPendingLogoUrl, type ISquadStorage } from './storage.js'
import type { ISquadVersionRepository } from './version-repository.js'
import type { SquadAssetRefreshConfig } from './asset-config.js'

interface SportsDbLeagueSummary {
  readonly idLeague: string
  readonly strLeague: string
  readonly strLeagueAlternate?: string | null
  readonly strSport?: string | null
}

interface SportsDbTeam {
  readonly idTeam?: string | null
  readonly idLeague?: string | null
  readonly strTeam?: string | null
  readonly strTeamAlternate?: string | null
  readonly strLeague?: string | null
  readonly strBadge?: string | null
}

interface SportsDbLeagueDetails {
  readonly idLeague?: string | null
  readonly strLeague?: string | null
  readonly strBadge?: string | null
  readonly strLogo?: string | null
}

interface AssetMatchContext {
  readonly leagueId: number
  readonly leagueName: string
  readonly leagueLogoUrl: string | null
}

export interface SquadAssetRefreshServiceOptions {
  readonly config: SquadAssetRefreshConfig
  readonly fetchImpl: typeof fetch
  readonly logger: ILogger
  readonly squadStorage: ISquadStorage
  readonly squadVersions: ISquadVersionRepository
  /** Wall-clock used for cache TTL bookkeeping; defaults to `Date.now`. */
  readonly now?: () => number
}

/**
 * TTL for cached SportsDB discovery JSON. The free-tier API rate-limits
 * aggressively (key "123" caps bursts at ~30 req/min), and the upstream
 * data — list of leagues, teams in a league, league badges — barely changes.
 * 7 days strikes the balance: refreshes survive provider outages and avoid
 * 429 storms, while still picking up the rare badge swap within a week.
 */
const SPORTSDB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class SquadAssetRefreshService {
  private readonly now: () => number

  constructor(private readonly options: SquadAssetRefreshServiceOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  async refreshLogos(): Promise<SquadAssetRefreshResult> {
    const versions = await this.options.squadVersions.list()
    this.options.logger.info('squad-sync', 'starting squad asset refresh', {
      storedVersions: versions.length,
    })
    if (versions.length === 0) {
      return {
        status: 'noop',
        versionCount: 0,
        clubCount: 0,
        updatedClubCount: 0,
        matchedClubCount: 0,
        matchedLeagueCount: 0,
        unmatchedClubs: [],
        unmatchedLeagues: [],
      }
    }

    const clubsByVersion = new Map<string, ReadonlyArray<Club>>()
    for (const version of versions) {
      const clubs = await this.options.squadStorage.getClubs(version.version)
      if (clubs) {
        clubsByVersion.set(version.version, clubs)
      }
    }
    if (clubsByVersion.size === 0) {
      return {
        status: 'noop',
        versionCount: versions.length,
        clubCount: 0,
        updatedClubCount: 0,
        matchedClubCount: 0,
        matchedLeagueCount: 0,
        unmatchedClubs: [],
        unmatchedLeagues: [],
      }
    }

    const representativeClubs = dedupeRepresentativeClubs([...clubsByVersion.values()].flat())

    // Skip the entire discovery phase when no club still carries a `pending:`
    // sentinel. The provider (TheSportsDB free tier) rate-limits aggressively
    // (~30 req/min on key "123"), so an unconditional refresh on every
    // retrieve quickly trips 429s. The badge-bytes cache short-circuits the
    // CDN download path, but discovery JSON would still hit the provider —
    // which is the actual cause of the 429s users were seeing. If everything
    // is already resolved, there's nothing to discover.
    const hasPendingClub = representativeClubs.some((club) => isPendingLogoUrl(club.logoUrl))
    if (!hasPendingClub) {
      this.options.logger.info('squad-sync', 'squad asset refresh skipped — nothing pending', {
        clubCount: representativeClubs.length,
      })
      return {
        status: 'noop',
        versionCount: clubsByVersion.size,
        clubCount: representativeClubs.length,
        updatedClubCount: 0,
        matchedClubCount: 0,
        matchedLeagueCount: 0,
        unmatchedClubs: [],
        unmatchedLeagues: [],
      }
    }

    const clubsByLeague = groupByLeagueName(representativeClubs)
    const allLeagues = await this.fetchAllLeagues()
    const leagueDetailsCache = new Map<string, AssetMatchContext>()
    const teamListCache = new Map<string, ReadonlyArray<SportsDbTeam>>()
    const clubLogoById = new Map<number, string>()
    const leagueMetaByKey = new Map<string, AssetMatchContext>()
    const unmatchedClubs: string[] = []
    const unmatchedLeagues = new Set<string>()

    for (const [leagueName, leagueClubs] of clubsByLeague) {
      const candidateLeagues = scoreLeagueCandidates(
        leagueName,
        allLeagues,
        this.options.config.leagueAliases,
      )
      let bestTeams: ReadonlyArray<SportsDbTeam> | null = null
      let bestLeague: SportsDbLeagueSummary | null = null
      let bestScore = -1

      for (const candidate of candidateLeagues.slice(0, 4)) {
        const teams = await this.fetchTeamsForLeague(candidate.strLeague, teamListCache)
        const score = scoreTeamsForLeague(leagueClubs, teams)
        if (score > bestScore) {
          bestScore = score
          bestTeams = teams
          bestLeague = candidate
        }
      }

      if (!bestTeams || bestScore <= 0) {
        unmatchedLeagues.add(leagueName)
        for (const club of leagueClubs) {
          const fallback = await this.searchTeamByClub(club)
          if (!fallback) {
            unmatchedClubs.push(club.name)
            continue
          }
          if (fallback.team.strBadge) {
            clubLogoById.set(club.id, fallback.team.strBadge)
          }
          const leagueMeta = fallback.team.idLeague
            ? await this.fetchLeagueContext(fallback.team.idLeague, leagueDetailsCache)
            : null
          if (leagueMeta) {
            leagueMetaByKey.set(buildLeagueKey(club.leagueId, club.leagueName), leagueMeta)
          }
        }
        continue
      }

      const leagueContext = bestLeague
        ? await this.fetchLeagueContext(bestLeague.idLeague, leagueDetailsCache)
        : null
      if (leagueContext) {
        for (const club of leagueClubs) {
          leagueMetaByKey.set(buildLeagueKey(club.leagueId, club.leagueName), leagueContext)
        }
      } else {
        unmatchedLeagues.add(leagueName)
      }

      for (const club of leagueClubs) {
        const team = pickBestTeamMatch(club, bestTeams)
        if (team?.strBadge) {
          clubLogoById.set(club.id, team.strBadge)
          continue
        }

        const fallback = await this.searchTeamByClub(club)
        if (fallback?.team.strBadge) {
          clubLogoById.set(club.id, fallback.team.strBadge)
          const fallbackLeagueMeta = fallback.team.idLeague
            ? await this.fetchLeagueContext(fallback.team.idLeague, leagueDetailsCache)
            : null
          if (fallbackLeagueMeta) {
            leagueMetaByKey.set(buildLeagueKey(club.leagueId, club.leagueName), fallbackLeagueMeta)
          }
        } else {
          unmatchedClubs.push(club.name)
        }
      }
    }

    // Download the badge bytes for every newly matched logo and cache them in
    // R2 so the public site can serve from the same origin (and survive
    // SportsDB outages). On success we rewrite Club.logoUrl to the worker
    // route; on failure we leave the SportsDB URL in place so the UI still
    // renders something.
    const cachedLogoUrlById = new Map<number, string>()
    for (const [clubId, sourceUrl] of clubLogoById) {
      try {
        const cached = await this.cacheLogoBytes(clubId, sourceUrl)
        if (cached) cachedLogoUrlById.set(clubId, cached)
      } catch (error) {
        this.options.logger.warn('squad-sync', 'logo cache failed; keeping source url', {
          clubId,
          sourceUrl,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    let updatedClubCount = 0
    let cachedLogoCount = 0
    for (const [version, clubs] of clubsByVersion) {
      let changed = false
      const updatedClubs = clubs.map((club) => {
        const refreshedSource = clubLogoById.get(club.id)
        const cachedUrl = cachedLogoUrlById.get(club.id)
        const nextLogoUrl = cachedUrl ?? refreshedSource ?? club.logoUrl
        if (cachedUrl) cachedLogoCount += 1
        const leagueMeta = leagueMetaByKey.get(buildLeagueKey(club.leagueId, club.leagueName))
        const nextLeagueLogoUrl = leagueMeta?.leagueLogoUrl ?? club.leagueLogoUrl ?? null
        const nextLeagueName = leagueMeta?.leagueName ?? club.leagueName
        if (
          nextLogoUrl === club.logoUrl &&
          nextLeagueLogoUrl === (club.leagueLogoUrl ?? null) &&
          nextLeagueName === club.leagueName
        ) {
          return club
        }
        changed = true
        updatedClubCount += 1
        return {
          ...club,
          logoUrl: nextLogoUrl,
          leagueName: nextLeagueName,
          leagueLogoUrl: nextLeagueLogoUrl,
        }
      })
      if (changed) {
        await this.options.squadStorage.putClubs(version, updatedClubs)
        this.options.logger.info('squad-sync', 'club assets refreshed for version', {
          version,
          clubCount: updatedClubs.length,
          cachedLogoCount,
        })
      }
    }

    const result: SquadAssetRefreshResult = {
      status: updatedClubCount > 0 ? 'refreshed' : 'noop',
      versionCount: clubsByVersion.size,
      clubCount: representativeClubs.length,
      updatedClubCount,
      matchedClubCount: clubLogoById.size,
      matchedLeagueCount: leagueMetaByKey.size,
      unmatchedClubs: [...new Set(unmatchedClubs)].sort(),
      unmatchedLeagues: [...unmatchedLeagues].sort(),
    }
    this.options.logger.info('squad-sync', 'squad asset refresh finished', result)
    return result
  }

  private async fetchAllLeagues(): Promise<ReadonlyArray<SportsDbLeagueSummary>> {
    const payload = await this.cachedJsonFetch<{
      leagues?: SportsDbLeagueSummary[]
      countries?: SportsDbLeagueSummary[]
    }>(
      `${this.options.config.providerBaseUrl}/all_leagues.php`,
      'sportsdb/all_leagues.json',
    )
    const rows = payload.leagues ?? payload.countries ?? []
    return rows.filter((row) => (row.strSport ?? '').toLowerCase() === 'soccer')
  }

  private async fetchTeamsForLeague(
    leagueName: string,
    cache: Map<string, ReadonlyArray<SportsDbTeam>>,
  ): Promise<ReadonlyArray<SportsDbTeam>> {
    const cacheKey = leagueName.trim().toLowerCase()
    const existing = cache.get(cacheKey)
    if (existing) return existing
    const payload = await this.cachedJsonFetch<{ teams?: SportsDbTeam[] }>(
      `${this.options.config.providerBaseUrl}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`,
      `sportsdb/teams-by-league/${slugify(leagueName)}.json`,
    )
    const teams = payload.teams ?? []
    cache.set(cacheKey, teams)
    return teams
  }

  private async fetchLeagueContext(
    leagueId: string,
    cache: Map<string, AssetMatchContext>,
  ): Promise<AssetMatchContext | null> {
    const existing = cache.get(leagueId)
    if (existing) return existing
    const payload = await this.cachedJsonFetch<{ leagues?: SportsDbLeagueDetails[] }>(
      `${this.options.config.providerBaseUrl}/lookupleague.php?id=${encodeURIComponent(leagueId)}`,
      `sportsdb/league-details/${encodeURIComponent(leagueId)}.json`,
    )
    const league = payload.leagues?.[0]
    if (!league?.idLeague || !league?.strLeague) return null
    const next = {
      leagueId: Number.parseInt(league.idLeague, 10),
      leagueName: league.strLeague,
      leagueLogoUrl: league.strBadge ?? league.strLogo ?? null,
    } satisfies AssetMatchContext
    cache.set(leagueId, next)
    return next
  }

  /**
   * Downloads a logo from its CDN URL and stores the bytes in R2 under
   * `squads/logos/{clubId}`. Returns the worker-relative URL that should be
   * written into `Club.logoUrl`, or `null` if the download failed (callers
   * keep the original source URL in that case).
   *
   * If the bytes are already cached and the source URL matches the previous
   * download, we skip the network round-trip entirely.
   */
  private async cacheLogoBytes(clubId: number, sourceUrl: string): Promise<string | null> {
    const existing = await this.options.squadStorage.getLogoBytes(clubId)
    if (existing && existing.sourceUrl === sourceUrl) {
      return clubLogoPublicPath(clubId)
    }
    const response = await this.options.fetchImpl(sourceUrl)
    if (!response.ok) {
      throw new Error(`logo fetch failed with status ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? 'image/png'
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0) {
      throw new Error('logo fetch returned an empty body')
    }
    await this.options.squadStorage.putLogoBytes(clubId, bytes, {
      contentType,
      sourceUrl,
      sourceEtag: response.headers.get('etag'),
    })
    return clubLogoPublicPath(clubId)
  }

  private async searchTeamByClub(
    club: Club,
  ): Promise<{ team: SportsDbTeam } | null> {
    const payload = await this.cachedJsonFetch<{ teams?: SportsDbTeam[] }>(
      `${this.options.config.providerBaseUrl}/searchteams.php?t=${encodeURIComponent(club.name)}`,
      `sportsdb/team-search/${slugify(club.name)}.json`,
    )
    const team = pickBestTeamMatch(club, payload.teams ?? [])
    return team ? { team } : null
  }

  /**
   * R2-backed JSON cache wrapper. Hits the provider only when there's no
   * cached envelope for `cacheKey`, or the cached envelope is older than
   * {@link SPORTSDB_CACHE_TTL_MS}. Once primed, repeat refreshes do zero
   * provider HTTP for already-discovered entries.
   *
   * The cache is shared across worker invocations (R2) and across the
   * worker + squad-sync CLI (same bucket), so seeding can happen from
   * either side.
   */
  private async cachedJsonFetch<T>(url: string, cacheKey: string): Promise<T> {
    const cached = await this.options.squadStorage.getCachedJson<T>(cacheKey)
    if (cached && this.now() - cached.cachedAt < SPORTSDB_CACHE_TTL_MS) {
      return cached.value
    }
    const fresh = await fetchJson<T>(this.options.fetchImpl, url)
    await this.options.squadStorage.putCachedJson(cacheKey, fresh, this.now())
    return fresh
  }
}

/** Lower-case alphanumerics + dashes; used to build cache keys from league/club names. */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown'
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`asset provider request failed (${response.status}) for ${url}`)
  }
  return (await response.json()) as T
}

function dedupeRepresentativeClubs(clubs: ReadonlyArray<Club>): Club[] {
  const byId = new Map<number, Club>()
  for (const club of clubs) {
    if (!byId.has(club.id)) {
      byId.set(club.id, club)
    }
  }
  return [...byId.values()]
}

function groupByLeagueName(clubs: ReadonlyArray<Club>): Map<string, Club[]> {
  const grouped = new Map<string, Club[]>()
  for (const club of clubs) {
    const bucket = grouped.get(club.leagueName)
    if (bucket) {
      bucket.push(club)
    } else {
      grouped.set(club.leagueName, [club])
    }
  }
  return grouped
}

function scoreLeagueCandidates(
  leagueName: string,
  leagues: ReadonlyArray<SportsDbLeagueSummary>,
  aliases: Readonly<Record<string, string>>,
): SportsDbLeagueSummary[] {
  const leagueNameNorm = normalizeText(leagueName)
  const explicitAliasNorm = aliases[leagueName]?.trim()
    ? normalizeText(aliases[leagueName]!)
    : null
  return [...leagues]
    .map((league) => {
      const primary = normalizeText(league.strLeague)
      const alternate = normalizeText(league.strLeagueAlternate ?? '')
      let score = 0
      if (explicitAliasNorm && (primary === explicitAliasNorm || alternate === explicitAliasNorm)) {
        score += 1000
      }
      if (primary === leagueNameNorm || alternate === leagueNameNorm) score += 300
      if (primary.includes(leagueNameNorm) || alternate.includes(leagueNameNorm)) score += 180
      if (leagueNameNorm.includes(primary) || leagueNameNorm.includes(alternate)) score += 120
      score += tokenOverlapScore(leagueNameNorm, primary)
      score += tokenOverlapScore(leagueNameNorm, alternate)
      return { league, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.league)
}

function scoreTeamsForLeague(clubs: ReadonlyArray<Club>, teams: ReadonlyArray<SportsDbTeam>): number {
  let score = 0
  for (const club of clubs) {
    const team = pickBestTeamMatch(club, teams)
    if (!team) continue
    score += 1
    if (normalizeText(team.strTeam ?? '') === normalizeText(club.name)) {
      score += 2
    }
  }
  return score
}

function pickBestTeamMatch(club: Club, teams: ReadonlyArray<SportsDbTeam>): SportsDbTeam | null {
  const clubName = normalizeText(club.name)
  const shortName = normalizeText(club.shortName)
  let best: { team: SportsDbTeam; score: number } | null = null
  for (const team of teams) {
    const teamName = normalizeText(team.strTeam ?? '')
    const alternates = normalizeAlternates(team.strTeamAlternate)
    let score = 0
    if (!teamName) continue
    if (teamName === clubName) score += 200
    if (alternates.includes(clubName)) score += 180
    if (shortName && (teamName === shortName || alternates.includes(shortName))) score += 90
    if (teamName.includes(clubName) || clubName.includes(teamName)) score += 50
    if (alternates.some((value) => value.includes(clubName) || clubName.includes(value))) score += 45
    if (normalizeText(team.strLeague ?? '') === normalizeText(club.leagueName)) score += 30
    score += tokenOverlapScore(clubName, teamName)
    if (!best || score > best.score) {
      best = { team, score }
    }
  }
  return best && best.score >= 60 ? best.team : null
}

function normalizeAlternates(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

function tokenOverlapScore(left: string, right: string): number {
  if (!left || !right) return 0
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 8
  }
  return overlap
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|cfc|club|women|men)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildLeagueKey(leagueId: number, leagueName: string): string {
  return `${leagueId}:${normalizeText(leagueName)}`
}

/**
 * Worker-relative URL for the cached logo. The web app prepends API_BASE
 * before assigning to `<img src>` (see `apps/web/src/lib/api.ts`).
 */
export function clubLogoPublicPath(clubId: number): string {
  return `/api/squads/logos/${clubId}`
}

export const __TEST_ONLY__ = {
  buildLeagueKey,
  normalizeText,
  pickBestTeamMatch,
  scoreLeagueCandidates,
}
