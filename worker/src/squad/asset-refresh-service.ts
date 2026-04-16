import type { Club, ILogger, SquadAssetRefreshResult } from '@fc26/shared'
import { isPendingLogoUrl, type ISquadStorage } from './storage.js'
import type { ISquadVersionRepository } from './version-repository.js'
import {
  DEFAULT_WIKIPEDIA_REST_BASE_URL,
  eaCdnClubBadgeUrl,
  eaCdnLeagueLogoUrl,
  type SquadAssetRefreshConfig,
} from './asset-config.js'

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
 * TTL for cached discovery JSON. Wikipedia data and EA CDN responses barely
 * change, so 7 days keeps us from hammering upstream on every refresh.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Any single upstream HTTP call that takes longer than this gets a WARN log
 * line. Wikipedia normally responds in <500ms; anything north of 2.5s usually
 * means the provider is degraded.
 */
const SLOW_REQUEST_THRESHOLD_MS = 2500

/**
 * Wall-clock threshold for a WARN line on `refreshLogos()` itself.
 */
const SLOW_REFRESH_THRESHOLD_MS = 60_000

/**
 * Max number of per-club Wikipedia fallback calls allowed in a single
 * `refreshLogos()` invocation.
 */
const PER_CLUB_WIKIPEDIA_BUDGET = 20

/**
 * Mode for {@link SquadAssetRefreshService.refreshLogos}.
 *
 * - `soft` (default): only resolve clubs whose stored `logoUrl` is still the
 *   `pending:club:{id}` sentinel (or empty).
 * - `hard`: re-resolve every club regardless of current `logoUrl`.
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
      resolvedClubCount: representativeClubs.length - pendingClubCount,
    })

    if (mode === 'soft' && pendingClubCount === 0) {
      this.options.logger.info('squad-sync', 'squad asset refresh skipped -- nothing pending', {
        clubCount: representativeClubs.length,
      })
      return {
        ...emptyResult(),
        versionCount: clubsByVersion.size,
        clubCount: representativeClubs.length,
        pendingClubCount: 0,
      }
    }

    const clubLogoById = new Map<number, string>()
    const clubLogoSourceById = new Map<number, 'eaCdn' | 'wikipedia'>()
    const leagueMetaByKey = new Map<string, AssetMatchContext>()
    const unmatchedClubs: string[] = []
    const unmatchedLeagues = new Set<string>()
    const wikipediaFallbackState = { rateLimited: false, budget: PER_CLUB_WIKIPEDIA_BUDGET }

    // Phase 0 -- EA CDN pass. EA's FUT Web App CDN serves badge PNGs keyed
    // by the same clubId that comes out of the squad binary, so no fuzzy
    // name matching is needed.
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
        // Network error -- skip, let Wikipedia handle it.
      }
    }
    this.options.logger.info('squad-sync', 'EA CDN badge pass finished', {
      resolved: eaCdnResolved.size,
      remaining: representativeClubs.filter(
        (c) => shouldResolveClubLogo(c, mode) && !clubLogoById.has(c.id),
      ).length,
    })

    // Phase 0b -- EA CDN league logos.
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
        // Network error -- skip.
      }
    }
    this.options.logger.info('squad-sync', 'EA CDN league logo pass finished', {
      resolved: leagueMetaByKey.size,
    })

    // Collect clubs that EA CDN could not resolve for Wikipedia backstop.
    for (const club of representativeClubs) {
      if (!shouldResolveClubLogo(club, mode)) continue
      if (clubLogoById.has(club.id)) continue
      unmatchedClubs.push(club.name)
    }

    // Phase 1 -- Wikipedia backstop: for any club EA CDN couldn't resolve,
    // try the club's Wikipedia article.
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

    // Badge byte caching phase -- download badge bytes for every newly
    // matched logo and cache them in R2.
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

    // Club record updates.
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

    // Structured summary report.
    const summaryContext = { ...result, elapsedMs }
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
   * Downloads a logo from its CDN URL and stores the bytes in R2 under
   * `squads/logos/{clubId}`. Returns the worker-relative URL that should be
   * written into `Club.logoUrl`, or `null` if the download failed.
   */
  private async cacheLogoBytes(
    clubId: number,
    sourceUrl: string,
  ): Promise<{ readonly path: string; readonly fromCache: boolean } | null> {
    const existing = await this.options.squadStorage.getLogoBytes(clubId)
    if (existing && existing.sourceUrl === sourceUrl) {
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

  /**
   * Wikipedia-backed resolution pass for clubs that EA CDN couldn't match.
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
        if (error instanceof Error && /429/.test(error.message)) {
          state.rateLimited = true
          this.options.logger.warn(
            'squad-sync',
            'wikipedia fallback hit 429; skipping remaining clubs',
            { clubName: name },
          )
          break
        }
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
   * image URL.
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
   * the cache TTL.
   */
  private async cachedJsonFetch<T>(url: string, cacheKey: string): Promise<T> {
    const cached = await this.options.squadStorage.getCachedJson<T>(cacheKey)
    if (cached && this.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value
    }
    const startedAt = this.now()
    const fresh = await fetchJson<T>(this.options.fetchImpl, url)
    const elapsedMs = this.now() - startedAt
    if (elapsedMs >= SLOW_REQUEST_THRESHOLD_MS) {
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

function buildLeagueKey(leagueId: number, leagueName: string): string {
  return `${leagueId}:${leagueName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').toLowerCase().trim()}`
}

/**
 * Worker-relative URL for the cached logo.
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
 * Build a small set of Wikipedia article-title guesses for a given club name.
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
 * Lightweight sanity filter for the image URL returned by Wikipedia.
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
 */
function shouldResolveClubLogo(
  club: { readonly logoUrl: string | null | undefined },
  mode: RefreshLogosMode,
): boolean {
  if (mode === 'hard') return true
  const url = club.logoUrl ?? ''
  return url.length === 0 || isPendingLogoUrl(url)
}

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
      wikipedia: 0,
    },
    byteCacheBreakdown: {
      downloaded: 0,
      alreadyCached: 0,
      failed: 0,
    },
  }
}

function countBySource(
  map: ReadonlyMap<number, 'eaCdn' | 'wikipedia'>,
  source: 'eaCdn' | 'wikipedia',
): number {
  let count = 0
  for (const value of map.values()) {
    if (value === source) count += 1
  }
  return count
}

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
  wikipediaTitleCandidates,
}
