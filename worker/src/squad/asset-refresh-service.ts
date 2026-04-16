import type { Club, ILogger, SquadAssetRefreshResult } from '@fc26/shared'
import { isPendingLogoUrl, type ISquadStorage } from './storage.js'
import type { ISquadVersionRepository } from './version-repository.js'
import {
  DEFAULT_WIKIPEDIA_REST_BASE_URL,
  eaCdnClubBadgeUrl,
  eaCdnLeagueLogoUrl,
  type SquadAssetRefreshConfig,
} from './asset-config.js'

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

/**
 * Error raised when the asset provider returns a rate-limit response. Kept as
 * a distinct class so callers can treat throttling as a partial failure
 * (skip this club and move on) rather than an aborting error. The primary
 * discovery endpoints still surface rate-limit errors as real failures —
 * there's nothing sensible to do without the league list — but the per-club
 * fallback loop uses this class to trip a circuit breaker.
 */
export class ProviderRateLimitError extends Error {
  constructor(readonly url: string) {
    super(`asset provider rate-limited (429) for ${url}`)
    this.name = 'ProviderRateLimitError'
  }
}

/**
 * Max number of per-club `searchteams.php` fallback calls allowed in a single
 * `refreshLogos()` invocation. Once the first N clubs have been matched via
 * league-wide discovery, any remaining pending clubs are almost certainly
 * obscure teams (lower leagues, women's sides, non-league friendlies) where
 * the per-club search is the only option. The budget prevents a long tail of
 * unresolvable clubs from hammering the provider and tripping 429s for every
 * future refresh within the same burst window.
 *
 * At 30 req/min on key "123", 20 per-refresh searches leaves headroom for
 * discovery JSON (leagues + teams + league details) plus badge byte
 * downloads without saturating the quota.
 */
const PER_CLUB_SEARCH_BUDGET = 20

/**
 * Any single upstream HTTP call that takes longer than this gets a WARN log
 * line. SportsDB and Wikipedia normally respond in <500ms; anything north
 * of 2.5s usually means the provider is degraded or we're hitting cold TCP
 * on Cloudflare's edge. Logging it gives ops a breadcrumb for "why did the
 * refresh take 90 seconds?" without spraying every request with timing
 * noise.
 */
const SLOW_REQUEST_THRESHOLD_MS = 2500

/**
 * Wall-clock threshold for a WARN line on `refreshLogos()` itself. Most
 * refreshes complete in single-digit seconds when the JSON cache is hot;
 * anything past a minute is worth a callout so a dev running under
 * `wrangler dev` notices without having to stare at the timestamps.
 */
const SLOW_REFRESH_THRESHOLD_MS = 60_000

/**
 * Mode for {@link SquadAssetRefreshService.refreshLogos}.
 *
 * - `soft` (default): only resolve clubs whose stored `logoUrl` is still the
 *   `pending:club:{id}` sentinel (or empty). Clubs that already carry a real
 *   logo are skipped entirely — no discovery call, no byte download. This is
 *   what a user pressing "Refresh missing logos" expects.
 * - `hard`: re-resolve every club regardless of current `logoUrl`. The R2
 *   byte-cache still short-circuits per-club when `sourceUrl` hasn't changed,
 *   so repeated hard refreshes are cheap unless the provider has moved the
 *   badge URL. Use this after fixing an aliasing bug or to force a refresh
 *   through a stale cache.
 */
export type RefreshLogosMode = 'soft' | 'hard'

export interface RefreshLogosOptions {
  readonly mode?: RefreshLogosMode
}

export class SquadAssetRefreshService {
  private readonly now: () => number

  constructor(private readonly options: SquadAssetRefreshServiceOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  async refreshLogos(options: RefreshLogosOptions = {}): Promise<SquadAssetRefreshResult> {
    const mode: RefreshLogosMode = options.mode ?? 'soft'
    const startedAt = this.now()
    const versions = await this.options.squadVersions.list()
    this.options.logger.info('squad-sync', 'starting squad asset refresh', {
      storedVersions: versions.length,
      mode,
    })
    if (versions.length === 0) {
      return emptyResult()
    }

    const clubsByVersion = new Map<string, ReadonlyArray<Club>>()
    for (const version of versions) {
      const clubs = await this.options.squadStorage.getClubs(version.version)
      if (clubs) {
        clubsByVersion.set(version.version, clubs)
      }
    }
    if (clubsByVersion.size === 0) {
      return { ...emptyResult(), versionCount: versions.length }
    }

    const representativeClubs = dedupeRepresentativeClubs([...clubsByVersion.values()].flat())
    const pendingClubCount = representativeClubs.filter((club) =>
      isPendingLogoUrl(club.logoUrl),
    ).length

    this.options.logger.info('squad-sync', 'squad asset refresh scope', {
      versionCount: clubsByVersion.size,
      clubCount: representativeClubs.length,
      pendingClubCount,
      // Counting already-resolved clubs separately helps distinguish "ingest
      // already did the work" from "we have nothing to resolve because
      // everything failed" — the two look identical from the summary line.
      resolvedClubCount: representativeClubs.length - pendingClubCount,
    })

    // Soft mode: skip the entire discovery phase when no club still carries a
    // `pending:` sentinel. The provider (TheSportsDB free tier) rate-limits
    // aggressively (~30 req/min on key "123"), so an unconditional refresh
    // on every retrieve quickly trips 429s. The badge-bytes cache short-
    // circuits the CDN download path, but discovery JSON would still hit the
    // provider — which is the actual cause of the 429s users were seeing.
    // If everything is already resolved, there's nothing to discover.
    //
    // Hard mode explicitly opts out of the short-circuit so a user can force
    // a full re-resolution after fixing an aliasing bug or seeding a fresh
    // alias map.
    if (mode === 'soft' && pendingClubCount === 0) {
      this.options.logger.info('squad-sync', 'squad asset refresh skipped — nothing pending', {
        clubCount: representativeClubs.length,
      })
      return {
        ...emptyResult(),
        versionCount: clubsByVersion.size,
        clubCount: representativeClubs.length,
        pendingClubCount: 0,
      }
    }

    const clubsByLeague = groupByLeagueName(representativeClubs)
    const allLeagues = await this.fetchAllLeagues()
    const leagueDetailsCache = new Map<string, AssetMatchContext>()
    const teamListCache = new Map<string, ReadonlyArray<SportsDbTeam>>()
    const clubLogoById = new Map<number, string>()
    // Tracks which source resolved each club — used to emit a per-source
    // breakdown at the end so ops can see at a glance whether SportsDB is
    // carrying the load or if we're leaning on Wikipedia / missing coverage.
    const clubLogoSourceById = new Map<number, 'eaCdn' | 'sportsdbLeague' | 'sportsdbFallback' | 'wikipedia'>()
    const leagueMetaByKey = new Map<string, AssetMatchContext>()
    const unmatchedClubs: string[] = []
    const unmatchedLeagues = new Set<string>()
    // Per-club `searchteams.php` is the most 429-prone call because it
    // spreads across every unmatched club. Track a circuit-breaker state so
    // the first throttled response aborts further per-club searches without
    // killing the rest of the refresh (discovery + badge caching can still
    // complete). Wikipedia has its own independent state so a SportsDB 429
    // doesn't disable the Wikipedia backstop — that's precisely when the
    // backstop matters most.
    const sportsDbFallbackState = { rateLimited: false, budget: PER_CLUB_SEARCH_BUDGET }
    const wikipediaFallbackState = { rateLimited: false, budget: PER_CLUB_SEARCH_BUDGET }

    // Phase 0 — EA CDN pass. EA's FUT Web App CDN serves badge PNGs keyed
    // by the same clubId that comes out of the squad binary, so no fuzzy
    // name matching is needed. We attempt a GET for every pending club;
    // 200 → cache to R2 and mark resolved, 404 → fall through to SportsDB.
    // The CDN is a public Akamai edge with generous rate limits.
    const eaCdnResolved = new Set<number>()
    for (const club of representativeClubs) {
      if (!shouldResolveClubLogo(club, mode)) continue
      if (clubLogoById.has(club.id)) continue
      const url = eaCdnClubBadgeUrl(club.id)
      try {
        const res = await this.options.fetchImpl(url)
        if (res.ok) {
          clubLogoById.set(club.id, url)
          clubLogoSourceById.set(club.id, 'eaCdn')
          eaCdnResolved.add(club.id)
        }
      } catch {
        // Network error — skip, let SportsDB handle it.
      }
    }
    this.options.logger.info('squad-sync', 'EA CDN badge pass finished', {
      resolved: eaCdnResolved.size,
      remaining: representativeClubs.filter(
        (c) => shouldResolveClubLogo(c, mode) && !clubLogoById.has(c.id),
      ).length,
    })

    // Phase 0b — EA CDN league logos. Uses the legacy FUT GUID (FC 24) which
    // still serves league logo PNGs keyed by leagueId.
    const resolvedLeagueIds = new Set<number>()
    for (const club of representativeClubs) {
      if (resolvedLeagueIds.has(club.leagueId)) continue
      resolvedLeagueIds.add(club.leagueId)
      const url = eaCdnLeagueLogoUrl(club.leagueId)
      try {
        const res = await this.options.fetchImpl(url)
        if (res.ok) {
          leagueMetaByKey.set(buildLeagueKey(club.leagueId, club.leagueName), {
            leagueId: club.leagueId,
            leagueName: club.leagueName,
            leagueLogoUrl: url,
          })
        }
      } catch {
        // Network error — SportsDB league details will fill this in.
      }
    }
    this.options.logger.info('squad-sync', 'EA CDN league logo pass finished', {
      resolved: leagueMetaByKey.size,
    })

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

      // Snapshot counters so we can log a per-league delta at the end of
      // this iteration. Lets ops see "Premier League: 20/20 matched via
      // SportsDB, 0 fallback, 0 miss" vs "Obscure League: 0/12 matched,
      // 12 unmatched" at a glance.
      const beforeLeagueMatched = clubLogoById.size
      const beforeSportsDbLeague = countBySource(clubLogoSourceById, 'sportsdbLeague')
      const beforeSportsDbFallback = countBySource(clubLogoSourceById, 'sportsdbFallback')

      if (!bestTeams || bestScore <= 0) {
        unmatchedLeagues.add(leagueName)
        for (const club of leagueClubs) {
          if (!shouldResolveClubLogo(club, mode)) continue
          const fallback = await this.tryFallbackSearch(club, sportsDbFallbackState)
          if (!fallback) {
            unmatchedClubs.push(club.name)
            continue
          }
          if (fallback.team.strBadge) {
            clubLogoById.set(club.id, fallback.team.strBadge)
            clubLogoSourceById.set(club.id, 'sportsdbFallback')
          }
          const leagueMeta = fallback.team.idLeague
            ? await this.fetchLeagueContext(fallback.team.idLeague, leagueDetailsCache)
            : null
          if (leagueMeta) {
            leagueMetaByKey.set(buildLeagueKey(club.leagueId, club.leagueName), leagueMeta)
          }
        }
        this.logLeagueOutcome(leagueName, leagueClubs.length, {
          sportsdbLeague: 0,
          sportsdbFallback:
            countBySource(clubLogoSourceById, 'sportsdbFallback') - beforeSportsDbFallback,
          matched: clubLogoById.size - beforeLeagueMatched,
          sportsDbLeagueHit: false,
        })
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
        if (!shouldResolveClubLogo(club, mode)) continue
        const team = pickBestTeamMatch(club, bestTeams)
        if (team?.strBadge) {
          clubLogoById.set(club.id, team.strBadge)
          clubLogoSourceById.set(club.id, 'sportsdbLeague')
          continue
        }

        const fallback = await this.tryFallbackSearch(club, sportsDbFallbackState)
        if (fallback?.team.strBadge) {
          clubLogoById.set(club.id, fallback.team.strBadge)
          clubLogoSourceById.set(club.id, 'sportsdbFallback')
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

      this.logLeagueOutcome(leagueName, leagueClubs.length, {
        sportsdbLeague:
          countBySource(clubLogoSourceById, 'sportsdbLeague') - beforeSportsDbLeague,
        sportsdbFallback:
          countBySource(clubLogoSourceById, 'sportsdbFallback') - beforeSportsDbFallback,
        matched: clubLogoById.size - beforeLeagueMatched,
        sportsDbLeagueHit: true,
      })
    }

    // Wikipedia backstop: for any club the SportsDB passes couldn't resolve,
    // try the club's Wikipedia article. Wikipedia's `page/summary` endpoint
    // returns an `originalimage` that is, for most senior football clubs,
    // the crest. Gives us coverage for obscure lower-league + women's sides
    // that SportsDB doesn't track. We deliberately run this AFTER the
    // SportsDB loop so Wikipedia only gets called for true misses.
    const stillUnmatched = dedupeInPlace(unmatchedClubs)
    if (stillUnmatched.length > 0) {
      const resolvedByName = await this.resolveLogosViaWikipedia(
        representativeClubs,
        stillUnmatched,
        wikipediaFallbackState,
      )
      if (resolvedByName.size > 0) {
        for (const club of representativeClubs) {
          const url = resolvedByName.get(club.name)
          if (url && !clubLogoById.has(club.id)) {
            clubLogoById.set(club.id, url)
            clubLogoSourceById.set(club.id, 'wikipedia')
          }
        }
        // Drop newly-resolved clubs from the unmatched list.
        unmatchedClubs.length = 0
        for (const name of stillUnmatched) {
          if (!resolvedByName.has(name)) unmatchedClubs.push(name)
        }
      }
      this.options.logger.info('squad-sync', 'wikipedia fallback pass finished', {
        unmatchedBefore: stillUnmatched.length,
        resolved: resolvedByName.size,
        remaining: unmatchedClubs.length,
        rateLimited: wikipediaFallbackState.rateLimited,
        budgetRemaining: wikipediaFallbackState.budget,
      })
    }

    // Download the badge bytes for every newly matched logo and cache them in
    // R2 so the public site can serve from the same origin (and survive
    // SportsDB outages). On success we rewrite Club.logoUrl to the worker
    // route; on failure we leave the SportsDB URL in place so the UI still
    // renders something.
    //
    // Logos essentially never change (EA team ids don't recycle; crest
    // designs are stable across seasons), so on repeat refreshes almost
    // every club should land in the `alreadyCached` bucket — if it doesn't,
    // something is telling the service the source URL changed when it
    // didn't. The per-run breakdown below makes that easy to spot.
    const cachedLogoUrlById = new Map<number, string>()
    const byteCacheBreakdown = { downloaded: 0, alreadyCached: 0, failed: 0 }
    for (const [clubId, sourceUrl] of clubLogoById) {
      try {
        const cached = await this.cacheLogoBytes(clubId, sourceUrl)
        if (cached) {
          cachedLogoUrlById.set(clubId, cached.path)
          if (cached.fromCache) {
            byteCacheBreakdown.alreadyCached += 1
          } else {
            byteCacheBreakdown.downloaded += 1
          }
        }
      } catch (error) {
        byteCacheBreakdown.failed += 1
        this.options.logger.warn('squad-sync', 'logo cache failed; keeping source url', {
          clubId,
          sourceUrl,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.options.logger.info('squad-sync', 'logo byte-cache pass finished', {
      ...byteCacheBreakdown,
      total: clubLogoById.size,
    })

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

    const matchBreakdown = {
      eaCdn: countBySource(clubLogoSourceById, 'eaCdn'),
      sportsdbLeague: countBySource(clubLogoSourceById, 'sportsdbLeague'),
      sportsdbFallback: countBySource(clubLogoSourceById, 'sportsdbFallback'),
      wikipedia: countBySource(clubLogoSourceById, 'wikipedia'),
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
      pendingClubCount,
      matchBreakdown,
      byteCacheBreakdown,
    }
    const elapsedMs = this.now() - startedAt
    const summaryContext = { ...result, elapsedMs }
    // Switch the final line to WARN when the whole run blew past the
    // "something is off" threshold. The payload is identical either way so
    // post-hoc grepping stays cheap; the level swap is what actually
    // surfaces in a noisy log stream.
    if (elapsedMs >= SLOW_REFRESH_THRESHOLD_MS) {
      this.options.logger.warn(
        'squad-sync',
        `squad asset refresh finished (slow: ${formatDuration(elapsedMs)})`,
        summaryContext,
      )
    } else {
      this.options.logger.info('squad-sync', 'squad asset refresh finished', summaryContext)
    }
    return result
  }

  /**
   * Tight per-league log line. Separate from the final summary because a
   * league-by-league breakdown is what ops ask for when a specific
   * competition doesn't have logos — "Premier League: 20/20 matched" makes
   * the "looked fine to me" league distinguishable from the failing ones
   * at a glance, without digging through the unmatched array.
   */
  private logLeagueOutcome(
    leagueName: string,
    clubCount: number,
    breakdown: {
      sportsdbLeague: number
      sportsdbFallback: number
      matched: number
      sportsDbLeagueHit: boolean
    },
  ): void {
    this.options.logger.info('squad-sync', 'league logo resolution outcome', {
      leagueName,
      clubCount,
      matched: breakdown.matched,
      sportsdbLeague: breakdown.sportsdbLeague,
      sportsdbFallback: breakdown.sportsdbFallback,
      unmatched: clubCount - breakdown.matched,
      // Distinguishes "SportsDB didn't match this league at all" (the
      // fallback-only path) from "SportsDB matched the league but not
      // every club inside it" — useful when diagnosing a 0/N league.
      sportsDbLeagueHit: breakdown.sportsDbLeagueHit,
    })
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
  private async cacheLogoBytes(
    clubId: number,
    sourceUrl: string,
  ): Promise<{ readonly path: string; readonly fromCache: boolean } | null> {
    const existing = await this.options.squadStorage.getLogoBytes(clubId)
    if (existing && existing.sourceUrl === sourceUrl) {
      // Source URL unchanged since the last download — the bytes in R2 are
      // still the crest we want. Skipping the re-download is the whole
      // point of the cache; it also means repeat refreshes cost ~0 on the
      // CDN side and complete in single-digit ms per club.
      return { path: clubLogoPublicPath(clubId), fromCache: true }
    }
    const downloadStartedAt = this.now()
    const response = await this.options.fetchImpl(sourceUrl)
    if (!response.ok) {
      throw new Error(`logo fetch failed with status ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? 'image/png'
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0) {
      throw new Error('logo fetch returned an empty body')
    }
    const downloadElapsedMs = this.now() - downloadStartedAt
    if (downloadElapsedMs >= SLOW_REQUEST_THRESHOLD_MS) {
      // Parity with `cachedJsonFetch` — a single crest shouldn't take
      // several seconds to come down from the CDN, and when it does it's
      // usually the source URL pointing at a slow Wikipedia thumbnail
      // server rather than SportsDB's CDN.
      this.options.logger.warn('squad-sync', 'slow logo download', {
        clubId,
        sourceUrl,
        elapsedMs: downloadElapsedMs,
        byteLength: bytes.byteLength,
      })
    }
    await this.options.squadStorage.putLogoBytes(clubId, bytes, {
      contentType,
      sourceUrl,
      sourceEtag: response.headers.get('etag'),
    })
    return { path: clubLogoPublicPath(clubId), fromCache: false }
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
   * Safe wrapper around `searchTeamByClub` that honours the fallback budget
   * and trips a circuit breaker on the first 429. Returns `null` (not-found
   * OR throttled OR budget exhausted) so the caller loop can move on to the
   * next club. Non-rate-limit errors still bubble up — a malformed response
   * or a config issue should surface loudly.
   *
   * The caller is responsible for recording the club as unmatched when we
   * return `null`; we deliberately don't mutate a shared list here so the
   * control flow stays local.
   */
  private async tryFallbackSearch(
    club: Club,
    state: { rateLimited: boolean; budget: number },
  ): Promise<{ team: SportsDbTeam } | null> {
    if (state.rateLimited || state.budget <= 0) return null
    state.budget -= 1
    try {
      return await this.searchTeamByClub(club)
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        state.rateLimited = true
        this.options.logger.warn(
          'squad-sync',
          'per-club fallback search hit 429; skipping remaining clubs',
          { clubName: club.name, url: error.url },
        )
        return null
      }
      // Any other failure (network, JSON parse, provider 5xx) is logged and
      // swallowed per-club so one bad name doesn't derail the rest of the
      // refresh. We still report it so ops can see it in the log stream.
      this.options.logger.warn('squad-sync', 'per-club fallback search failed', {
        clubName: club.name,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Wikipedia-backed resolution pass for clubs that SportsDB couldn't match.
   *
   * Strategy: for each unmatched club name, hit the REST API
   * `page/summary/{title}` endpoint. Wikipedia handles article-title
   * normalisation + redirects server-side, so `Bayern Munich` → the canonical
   * article with `originalimage.source` pointing at the crest. When the page
   * doesn't exist (404) or has no image, the club stays unmatched.
   *
   * Rate-limiting: Wikipedia's per-IP budget is generous (~200 req/s), but
   * we still honour the same circuit breaker + budget as SportsDB. This is
   * shared state — once either provider is flagged throttled we stop hitting
   * both. That's intentional: a Worker run with 60 unmatched clubs should
   * not try 60 Wikipedia lookups on every ingest even if the provider
   * accepts them.
   */
  private async resolveLogosViaWikipedia(
    clubs: ReadonlyArray<Club>,
    unmatchedNames: ReadonlyArray<string>,
    state: { rateLimited: boolean; budget: number },
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    const clubsByName = new Map<string, Club>()
    for (const club of clubs) {
      if (!clubsByName.has(club.name)) clubsByName.set(club.name, club)
    }

    for (const name of unmatchedNames) {
      if (state.rateLimited || state.budget <= 0) break
      const club = clubsByName.get(name)
      if (!club) continue
      state.budget -= 1
      try {
        const logoUrl = await this.lookupWikipediaLogo(club)
        if (logoUrl) {
          result.set(name, logoUrl)
          this.options.logger.info('squad-sync', 'wikipedia fallback matched club logo', {
            clubName: name,
            clubId: club.id,
          })
        }
      } catch (error) {
        if (error instanceof ProviderRateLimitError) {
          state.rateLimited = true
          this.options.logger.warn(
            'squad-sync',
            'wikipedia fallback hit 429; skipping remaining clubs',
            { clubName: name, url: error.url },
          )
          break
        }
        // A 404 is normal (no article); anything else is surfaced but not
        // fatal — the club just stays unmatched.
        this.options.logger.debug('squad-sync', 'wikipedia lookup failed', {
          clubName: name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  }

  /**
   * Query Wikipedia's `page/summary` endpoint and extract the best crest-ish
   * image URL. We try a handful of title variants (raw name, `"{name} F.C."`,
   * stripped suffixes) because club naming is wildly inconsistent on the
   * upstream side — "Arsenal" vs "Arsenal F.C." vs "Arsenal Football Club".
   * The first variant that returns a page with an image wins; other variants
   * aren't tried to keep the budget tight.
   */
  private async lookupWikipediaLogo(club: Club): Promise<string | null> {
    const candidates = wikipediaTitleCandidates(club.name)
    const wikipediaBase =
      this.options.config.wikipediaBaseUrl || DEFAULT_WIKIPEDIA_REST_BASE_URL
    for (const title of candidates) {
      const cacheKey = `wikipedia/page-summary/${slugify(title)}.json`
      const url = `${wikipediaBase}/page/summary/${encodeURIComponent(title)}`
      let payload: WikipediaPageSummary | null
      try {
        payload = await this.cachedJsonFetch<WikipediaPageSummary>(url, cacheKey)
      } catch (error) {
        // A 404 is the most common branch (article missing). We swallow it
        // only for the 404 case to let other candidates try — anything else
        // bubbles so the caller can handle rate-limit uniformly.
        if (error instanceof Error && /\(404\)/.test(error.message)) {
          continue
        }
        throw error
      }
      const image = payload?.originalimage?.source ?? payload?.thumbnail?.source ?? null
      if (image && looksLikeClubCrestImage(image)) {
        return image
      }
    }
    return null
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
    const startedAt = this.now()
    const fresh = await fetchJson<T>(this.options.fetchImpl, url)
    const elapsedMs = this.now() - startedAt
    if (elapsedMs >= SLOW_REQUEST_THRESHOLD_MS) {
      // Per-call slow warning. We flag these so a dev scanning the log
      // stream can spot which upstream endpoint is the culprit when a
      // refresh drags — `elapsedMs` + `url` is enough to locate the
      // regression in the provider without extra tooling.
      this.options.logger.warn('squad-sync', 'slow upstream request', {
        url,
        cacheKey,
        elapsedMs,
      })
    }
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
  if (response.status === 429) {
    throw new ProviderRateLimitError(url)
  }
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

interface WikipediaPageSummary {
  readonly title?: string | null
  readonly originalimage?: { source?: string | null } | null
  readonly thumbnail?: { source?: string | null } | null
}

function dedupeInPlace(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)]
}

/**
 * Build a small set of Wikipedia article-title guesses for a given club
 * name. Order matters — the first hit wins, so we go from most specific
 * (adds "F.C." which matches a huge chunk of senior football articles) to
 * least (raw name). Keeping the list short (≤3 entries) keeps the per-club
 * budget predictable.
 */
function wikipediaTitleCandidates(clubName: string): string[] {
  const trimmed = clubName.trim()
  if (!trimmed) return []
  const stripped = trimmed
    .replace(/\s+(F\.?C\.?|CF|SC|AFC|Club|Football Club)$/i, '')
    .trim()
  const candidates: string[] = []
  const push = (value: string) => {
    if (value && !candidates.includes(value)) candidates.push(value)
  }
  push(trimmed)
  push(`${stripped} F.C.`)
  push(`${stripped} (football club)`)
  return candidates
}

/**
 * Very lightweight sanity filter for the image URL returned by Wikipedia.
 * The `originalimage` field can occasionally be a match-action photo or a
 * kit diagram instead of a crest. A perfect classifier would need vision,
 * but we can cheaply reject known-bad patterns: URLs that clearly point at
 * portraits, stadium photos, or kit SVGs. The filter is deliberately
 * permissive — we'd rather accept a non-crest image than miss a real one,
 * since the UI already falls back to a generated SVG badge.
 */
function looksLikeClubCrestImage(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.includes('kit_body') || lower.includes('kit_socks') || lower.includes('kit_shorts')) {
    return false
  }
  if (lower.endsWith('.pdf')) return false
  return true
}

/**
 * Per-club gate for logo resolution.
 *
 * - `soft` mode: skip clubs that already carry a real logo. That's the whole
 *   point of soft refresh — don't burn provider quota re-matching teams we
 *   already have crests for. Empty/null/pending sentinel still qualifies.
 * - `hard` mode: always resolve. The R2 byte cache will short-circuit the
 *   actual download per-club when `sourceUrl` hasn't changed, so the cost
 *   is the discovery JSON (which is R2-cached with a 7-day TTL anyway).
 */
function shouldResolveClubLogo(
  club: { readonly logoUrl: string | null | undefined },
  mode: RefreshLogosMode,
): boolean {
  if (mode === 'hard') return true
  const url = club.logoUrl ?? ''
  return url.length === 0 || isPendingLogoUrl(url)
}

/**
 * Baseline zero-value `SquadAssetRefreshResult`. Used at the early-return
 * points in `refreshLogos()` so the shape stays consistent across "no
 * versions", "no clubs", and "nothing pending" branches without sprinkling
 * literal initialisers throughout the method. Callers spread-override the
 * fields that actually have values for their branch.
 */
function emptyResult(): SquadAssetRefreshResult {
  return {
    status: 'noop',
    versionCount: 0,
    clubCount: 0,
    updatedClubCount: 0,
    matchedClubCount: 0,
    matchedLeagueCount: 0,
    unmatchedClubs: [],
    unmatchedLeagues: [],
    pendingClubCount: 0,
    matchBreakdown: {
      eaCdn: 0,
      sportsdbLeague: 0,
      sportsdbFallback: 0,
      wikipedia: 0,
    },
    byteCacheBreakdown: {
      downloaded: 0,
      alreadyCached: 0,
      failed: 0,
    },
  }
}

/**
 * Tallies entries in `clubLogoSourceById` matching a given source. Used to
 * snapshot counts before/after a league iteration (per-league delta log) and
 * to build the final `matchBreakdown` summary.
 */
function countBySource(
  map: ReadonlyMap<number, 'sportsdbLeague' | 'sportsdbFallback' | 'wikipedia'>,
  source: 'sportsdbLeague' | 'sportsdbFallback' | 'wikipedia',
): number {
  let count = 0
  for (const value of map.values()) {
    if (value === source) count += 1
  }
  return count
}

/**
 * Compact human-readable elapsed-time rendering for the summary WARN line.
 * Keeps things readable in log aggregators: a 73-second refresh shows as
 * "1m 13s" rather than "73000ms". Sub-second values still render with a
 * decimal (rare — a refresh that fast skipped discovery entirely).
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

export const __TEST_ONLY__ = {
  buildLeagueKey,
  normalizeText,
  pickBestTeamMatch,
  scoreLeagueCandidates,
  wikipediaTitleCandidates,
}
