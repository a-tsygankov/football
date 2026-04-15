import { describe, expect, it } from 'vitest'
import type { Club, SquadVersion } from '@fc26/shared'
import { WorkerLogger } from '../logger.js'
import { InMemorySquadStorage } from './in-memory-storage.js'
import { SquadAssetRefreshService } from './asset-refresh-service.js'
import { InMemorySquadVersionRepository } from './version-repository.js'

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
  logoUrl: 'https://placeholder.example/1.png',
  starRating: 4,
}

const clubTwo: Club = {
  ...clubOne,
  id: 2,
  name: 'Chelsea',
  shortName: 'CHE',
  logoUrl: 'https://placeholder.example/2.png',
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
})
