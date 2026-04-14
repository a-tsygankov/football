import type { Club, ILogger, SquadAssetRefreshResult } from '@fc26/shared'
import type { ISquadStorage } from './storage.js'
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
}

export class SquadAssetRefreshService {
  constructor(private readonly options: SquadAssetRefreshServiceOptions) {}

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

    let updatedClubCount = 0
    for (const [version, clubs] of clubsByVersion) {
      let changed = false
      const updatedClubs = clubs.map((club) => {
        const nextLogoUrl = clubLogoById.get(club.id) ?? club.logoUrl
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
    const payload = await fetchJson<{ leagues?: SportsDbLeagueSummary[]; countries?: SportsDbLeagueSummary[] }>(
      this.options.fetchImpl,
      `${this.options.config.providerBaseUrl}/all_leagues.php`,
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
    const payload = await fetchJson<{ teams?: SportsDbTeam[] }>(
      this.options.fetchImpl,
      `${this.options.config.providerBaseUrl}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`,
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
    const payload = await fetchJson<{ leagues?: SportsDbLeagueDetails[] }>(
      this.options.fetchImpl,
      `${this.options.config.providerBaseUrl}/lookupleague.php?id=${encodeURIComponent(leagueId)}`,
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

  private async searchTeamByClub(
    club: Club,
  ): Promise<{ team: SportsDbTeam } | null> {
    const payload = await fetchJson<{ teams?: SportsDbTeam[] }>(
      this.options.fetchImpl,
      `${this.options.config.providerBaseUrl}/searchteams.php?t=${encodeURIComponent(club.name)}`,
    )
    const team = pickBestTeamMatch(club, payload.teams ?? [])
    return team ? { team } : null
  }
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

export const __TEST_ONLY__ = {
  buildLeagueKey,
  normalizeText,
  pickBestTeamMatch,
  scoreLeagueCandidates,
}
