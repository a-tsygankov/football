import { describe, expect, it } from 'vitest'
import type { Club, SquadVersion } from '@fc26/shared'
import { WorkerLogger } from '../logger.js'
import { InMemorySquadStorage } from './in-memory-storage.js'
import { SquadAssetRefreshService } from './asset-refresh-service.js'
import { PENDING_LOGO_PREFIX } from './storage.js'
import { InMemorySquadVersionRepository } from './version-repository.js'

// Clubs reach the asset-refresh service with the `pending:club:{id}` sentinel
// in `logoUrl` — that's how the ingest leaves them, and the service uses that
// marker to know there's something to resolve. Non-pending clubs short-circuit
// the discovery phase entirely (see `refreshLogos` in the service).
const clubOne: Club = {
  id: 1,
  name: 'Arsenal',
  shortName: 'ARS',
  leagueId: 13,
  leagueName: 'Premier League',
  nationId: 14,
  overallRating: 84,
  attackRating: 84,
  midfieldRating: 84,
  defenseRating: 82,
  avatarUrl: null,
  logoUrl: `${PENDING_LOGO_PREFIX}1`,
  starRating: 4,
}

const clubTwo: Club = {
  ...clubOne,
  id: 2,
  name: 'Chelsea',
  shortName: 'CHE',
  logoUrl: `${PENDING_LOGO_PREFIX}2`,
}

function version(version: string, ingestedAt: number): SquadVersion {
  return {
    version,
    releasedAt: null,
    ingestedAt,
    clubsBytes: 1,
    clubCount: 2,
    playerCount: 0,
    sourceUrl: 'https://example.com',
    notes: null,
  }
}

describe('SquadAssetRefreshService', () => {
  it('refreshes club and league logos across retained versions', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    await squadVersions.insert(version('fc26-r11', 2_000))
    await squadStorage.putClubs('fc26-r10', [clubOne, clubTwo])
    await squadStorage.putClubs('fc26-r11', [clubOne, clubTwo])

    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/all_leagues.php')) {
        return Response.json({
          leagues: [
            {
              idLeague: '4328',
              strSport: 'Soccer',
              strLeague: 'English Premier League',
              strLeagueAlternate: 'Premier League, EPL, England',
            },
          ],
        })
      }
      if (url.includes('/search_all_teams.php?l=')) {
        return Response.json({
          teams: [
            {
              idTeam: '133604',
              idLeague: '4328',
              strTeam: 'Arsenal',
              strTeamAlternate: 'Arsenal Football Club, AFC, Arsenal FC',
              strLeague: 'English Premier League',
              strBadge: 'https://assets.example/teams/arsenal.png',
            },
            {
              idTeam: '133610',
              idLeague: '4328',
              strTeam: 'Chelsea',
              strTeamAlternate: 'Chelsea Football Club, Chelsea FC, CFC',
              strLeague: 'English Premier League',
              strBadge: 'https://assets.example/teams/chelsea.png',
            },
          ],
        })
      }
      if (url.includes('/lookupleague.php?id=4328')) {
        return Response.json({
          leagues: [
            {
              idLeague: '4328',
              strLeague: 'English Premier League',
              strBadge: 'https://assets.example/leagues/epl.png',
            },
          ],
        })
      }
      if (url.startsWith('https://assets.example/teams/')) {
        // Tiny PNG-ish payload — content doesn't matter, only the bytes round-trip.
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png', etag: 'W/"badge"' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {
        providerBaseUrl: 'https://assets.example/api',
        leagueAliases: {
          'Premier League': 'English Premier League',
        },
      },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh'),
      squadStorage,
      squadVersions,
    })

    const result = await service.refreshLogos()
    expect(result.status).toBe('refreshed')
    expect(result.versionCount).toBe(2)
    expect(result.matchedClubCount).toBe(2)
    expect(result.matchedLeagueCount).toBe(1)
    expect(result.unmatchedClubs).toEqual([])
    expect(result.unmatchedLeagues).toEqual([])

    const updatedLatest = await squadStorage.getClubs('fc26-r11')
    expect(updatedLatest).toEqual([
      {
        ...clubOne,
        leagueName: 'English Premier League',
        leagueLogoUrl: 'https://assets.example/leagues/epl.png',
        // Once the badge is fetched and cached in R2, Club.logoUrl points at
        // the worker's cached-asset route so the public site can serve from
        // the same origin and survive SportsDB outages.
        logoUrl: '/api/squads/logos/1',
      },
      {
        ...clubTwo,
        leagueName: 'English Premier League',
        leagueLogoUrl: 'https://assets.example/leagues/epl.png',
        logoUrl: '/api/squads/logos/2',
      },
    ])
    const updatedOlder = await squadStorage.getClubs('fc26-r10')
    expect(updatedOlder?.[0]?.leagueLogoUrl).toBe('https://assets.example/leagues/epl.png')
    expect(requests.some((url) => url.endsWith('/all_leagues.php'))).toBe(true)

    // The badge bytes round-trip back through storage.
    const cachedArsenal = await squadStorage.getLogoBytes(1)
    expect(cachedArsenal?.contentType).toBe('image/png')
    expect(new Uint8Array(cachedArsenal!.bytes)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    )
    expect(cachedArsenal?.sourceUrl).toBe('https://assets.example/teams/arsenal.png')
  })

  it('skips re-downloading a logo when the source URL still matches', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    await squadStorage.putClubs('fc26-r10', [clubOne])
    // Pre-cache the Arsenal logo with the source URL the next refresh will
    // discover. The badge endpoint should not be hit on the second pass.
    await squadStorage.putLogoBytes(1, new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
      sourceUrl: 'https://assets.example/teams/arsenal.png',
    })

    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/all_leagues.php')) {
        return Response.json({
          leagues: [
            {
              idLeague: '4328',
              strSport: 'Soccer',
              strLeague: 'English Premier League',
            },
          ],
        })
      }
      if (url.includes('/search_all_teams.php?l=')) {
        return Response.json({
          teams: [
            {
              idTeam: '133604',
              idLeague: '4328',
              strTeam: 'Arsenal',
              strLeague: 'English Premier League',
              strBadge: 'https://assets.example/teams/arsenal.png',
            },
          ],
        })
      }
      if (url.includes('/lookupleague.php?id=4328')) {
        return Response.json({ leagues: [{ idLeague: '4328', strLeague: 'EPL' }] })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {
        providerBaseUrl: 'https://assets.example/api',
        leagueAliases: { 'Premier League': 'English Premier League' },
      },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-skip'),
      squadStorage,
      squadVersions,
    })

    await service.refreshLogos()
    // Critically, no badge download was triggered.
    expect(requests.some((url) => url.startsWith('https://assets.example/teams/'))).toBe(false)
  })

  it('short-circuits when no club still carries the pending sentinel', async () => {
    // A user who pressed `Refresh logos` after a successful prior run should
    // not burn provider quota — every club already has a real logoUrl.
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    const resolvedClub: Club = { ...clubOne, logoUrl: '/api/squads/logos/1' }
    await squadStorage.putClubs('fc26-r10', [resolvedClub])

    let requestCount = 0
    const fetchImpl: typeof fetch = async () => {
      requestCount += 1
      throw new Error('provider should not be hit')
    }
    const service = new SquadAssetRefreshService({
      config: { providerBaseUrl: 'https://assets.example/api', leagueAliases: {} },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-noop'),
      squadStorage,
      squadVersions,
    })

    const result = await service.refreshLogos()
    expect(result.status).toBe('noop')
    expect(result.matchedClubCount).toBe(0)
    expect(requestCount).toBe(0)
  })

  it('reuses the R2 JSON cache instead of refetching discovery endpoints within TTL', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    await squadStorage.putClubs('fc26-r10', [clubOne])

    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/all_leagues.php')) {
        return Response.json({
          leagues: [
            {
              idLeague: '4328',
              strSport: 'Soccer',
              strLeague: 'English Premier League',
              strLeagueAlternate: 'Premier League',
            },
          ],
        })
      }
      if (url.includes('/search_all_teams.php?l=')) {
        return Response.json({
          teams: [
            {
              idTeam: '133604',
              idLeague: '4328',
              strTeam: 'Arsenal',
              strLeague: 'English Premier League',
              strBadge: 'https://assets.example/teams/arsenal.png',
            },
          ],
        })
      }
      if (url.includes('/lookupleague.php?id=4328')) {
        return Response.json({
          leagues: [
            { idLeague: '4328', strLeague: 'English Premier League', strBadge: 'https://assets.example/leagues/epl.png' },
          ],
        })
      }
      if (url.startsWith('https://assets.example/teams/')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    let now = 1_700_000_000_000
    const service = new SquadAssetRefreshService({
      config: { providerBaseUrl: 'https://assets.example/api', leagueAliases: {} },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-cache'),
      squadStorage,
      squadVersions,
      now: () => now,
    })

    await service.refreshLogos()
    const firstPassRequests = [...requests]
    expect(firstPassRequests.some((url) => url.endsWith('/all_leagues.php'))).toBe(true)

    // Re-introduce a pending club so the short-circuit doesn't kick in; the
    // discovery JSON should still come from the cache.
    requests.length = 0
    await squadStorage.putClubs('fc26-r10', [
      { ...clubOne, logoUrl: `${PENDING_LOGO_PREFIX}1` },
    ])
    now += 60_000 // one minute later, well within the 7-day TTL

    await service.refreshLogos()

    // The discovery JSON endpoints should NOT have been hit again. Only the
    // badge bytes path may run (and only when the source URL changed; here
    // it's the same URL so its own cache short-circuits too).
    expect(requests.some((url) => url.endsWith('/all_leagues.php'))).toBe(false)
    expect(requests.some((url) => url.includes('/search_all_teams.php'))).toBe(false)
    expect(requests.some((url) => url.includes('/lookupleague.php'))).toBe(false)
  })

  it('refetches discovery JSON after the cache TTL elapses', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    await squadStorage.putClubs('fc26-r10', [clubOne])

    let allLeaguesCalls = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/all_leagues.php')) {
        allLeaguesCalls += 1
        return Response.json({
          leagues: [
            { idLeague: '4328', strSport: 'Soccer', strLeague: 'English Premier League' },
          ],
        })
      }
      if (url.includes('/search_all_teams.php?l=')) {
        return Response.json({
          teams: [
            {
              idTeam: '133604',
              idLeague: '4328',
              strTeam: 'Arsenal',
              strLeague: 'English Premier League',
              strBadge: 'https://assets.example/teams/arsenal.png',
            },
          ],
        })
      }
      if (url.includes('/lookupleague.php?id=4328')) {
        return Response.json({
          leagues: [{ idLeague: '4328', strLeague: 'English Premier League' }],
        })
      }
      if (url.startsWith('https://assets.example/teams/')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    let now = 1_700_000_000_000
    const service = new SquadAssetRefreshService({
      config: {
        providerBaseUrl: 'https://assets.example/api',
        leagueAliases: { 'Premier League': 'English Premier League' },
      },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-ttl'),
      squadStorage,
      squadVersions,
      now: () => now,
    })

    await service.refreshLogos()
    expect(allLeaguesCalls).toBe(1)

    // Reset pending state so refreshLogos doesn't short-circuit, then jump
    // past the 7-day TTL.
    await squadStorage.putClubs('fc26-r10', [
      { ...clubOne, logoUrl: `${PENDING_LOGO_PREFIX}1` },
    ])
    now += 8 * 24 * 60 * 60 * 1000

    await service.refreshLogos()
    expect(allLeaguesCalls).toBe(2)
  })

  it('propagates provider errors so the route can surface them', async () => {
    // The free-tier SportsDB key gets 429s under burst load. The service
    // surfaces those as exceptions; the /squad-assets/refresh route catches
    // and renders a 502 with a structured body. (Verified separately in the
    // route tests.)
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    await squadStorage.putClubs('fc26-r10', [clubOne])

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/all_leagues.php')) {
        return new Response('{"error":"throttled"}', { status: 429 })
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const service = new SquadAssetRefreshService({
      config: { providerBaseUrl: 'https://assets.example/api', leagueAliases: {} },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-429'),
      squadStorage,
      squadVersions,
    })

    await expect(service.refreshLogos()).rejects.toThrow(/429/)
  })
})
