import { describe, expect, it } from 'vitest'
import type { Club, SquadVersion } from '@fc26/shared'
import { WorkerLogger } from '../logger.js'
import { InMemorySquadStorage } from './in-memory-storage.js'
import { SquadAssetRefreshService } from './asset-refresh-service.js'
import { PENDING_LOGO_PREFIX } from './storage.js'
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
  it('refreshes club logos via EA CDN across retained versions', async () => {
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
      // EA CDN club badge -- return OK for any club badge URL
      if (url.includes('/clubs/dark/')) {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png', etag: 'W/"badge"' },
        })
      }
      // EA CDN league logo
      if (url.includes('/leagueLogos/dark/')) {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {},
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh'),
      squadStorage,
      squadVersions,
    })

    const result = await service.refreshLogos()
    expect(result.status).toBe('refreshed')
    expect(result.versionCount).toBe(2)
    expect(result.matchedClubCount).toBe(2)
    expect(result.matchBreakdown.eaCdn).toBe(2)
    expect(result.unmatchedClubs).toEqual([])

    const updatedLatest = await squadStorage.getClubs('fc26-r11')
    expect(updatedLatest?.[0]?.logoUrl).toBe('/api/squads/logos/1')
    expect(updatedLatest?.[1]?.logoUrl).toBe('/api/squads/logos/2')

    // The badge bytes round-trip back through storage.
    const cachedArsenal = await squadStorage.getLogoBytes(1)
    expect(cachedArsenal?.contentType).toBe('image/png')
    expect(new Uint8Array(cachedArsenal!.bytes)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    )
  })

  it('skips re-downloading a logo when the source URL still matches', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    await squadStorage.putClubs('fc26-r10', [clubOne])

    const eaCdnBadgeUrl =
      'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/clubs/dark/1.png'
    // Pre-cache the Arsenal logo with the source URL the next refresh will
    // discover.
    await squadStorage.putLogoBytes(1, new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
      sourceUrl: eaCdnBadgeUrl,
    })

    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      // EA CDN club badge
      if (url.includes('/clubs/dark/')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      // EA CDN league logo
      if (url.includes('/leagueLogos/dark/')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {},
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-skip'),
      squadStorage,
      squadVersions,
    })

    await service.refreshLogos()
    // The badge download URL should have been fetched (EA CDN pass), but the
    // byte-cache should have short-circuited the actual badge download.
    const badgeDownloads = requests.filter(
      (url) => url.includes('/clubs/dark/1.png'),
    )
    // First hit is the EA CDN check; no second hit because the byte cache matched.
    expect(badgeDownloads.length).toBe(1)
  })

  it('short-circuits when no club still carries the pending sentinel', async () => {
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
      config: {},
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

  it('falls back to Wikipedia when EA CDN cannot match a club', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    const obscure: Club = {
      ...clubOne,
      id: 77,
      name: 'SV Ried',
      shortName: 'RIE',
      leagueName: 'Austrian Bundesliga',
      logoUrl: `${PENDING_LOGO_PREFIX}77`,
    }
    await squadStorage.putClubs('fc26-r10', [obscure])

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      // EA CDN club badge -- return 404 to force Wikipedia fallback
      if (url.includes('/clubs/dark/')) {
        return new Response(null, { status: 404 })
      }
      // EA CDN league logo
      if (url.includes('/leagueLogos/dark/')) {
        return new Response(null, { status: 404 })
      }
      if (url.includes('/page/summary/')) {
        return Response.json({
          title: 'SV Ried',
          originalimage: { source: 'https://upload.wikimedia.example/sv-ried.png' },
        })
      }
      if (url === 'https://upload.wikimedia.example/sv-ried.png') {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {
        wikipediaBaseUrl: 'https://wiki.example/api/rest_v1',
      },
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-wiki'),
      squadStorage,
      squadVersions,
    })

    const result = await service.refreshLogos()
    expect(result.matchedClubCount).toBe(1)
    expect(result.matchBreakdown.wikipedia).toBe(1)
    expect(result.unmatchedClubs).toEqual([])
    const cached = await squadStorage.getLogoBytes(77)
    expect(cached?.sourceUrl).toBe('https://upload.wikimedia.example/sv-ried.png')
    const updated = await squadStorage.getClubs('fc26-r10')
    expect(updated?.[0]?.logoUrl).toBe('/api/squads/logos/77')
  })

  it('soft mode skips clubs that already carry a real logo', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    const resolved: Club = { ...clubOne, logoUrl: '/api/squads/logos/1' }
    const pending: Club = { ...clubTwo, logoUrl: `${PENDING_LOGO_PREFIX}2` }
    await squadStorage.putClubs('fc26-r10', [resolved, pending])

    const eaCdnFetches: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/clubs/dark/')) {
        eaCdnFetches.push(url)
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      if (url.includes('/leagueLogos/dark/')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {},
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-soft'),
      squadStorage,
      squadVersions,
    })

    const result = await service.refreshLogos()
    // Only the pending Chelsea badge was resolved; resolved Arsenal was skipped.
    expect(eaCdnFetches).toEqual(
      expect.arrayContaining([expect.stringContaining('/clubs/dark/2.png')]),
    )
    expect(eaCdnFetches.some((u) => u.includes('/clubs/dark/1.png'))).toBe(false)
    expect(result.matchedClubCount).toBe(1)
    expect(result.matchBreakdown.eaCdn).toBe(1)
  })

  it('hard mode re-resolves clubs even when every logo is already real', async () => {
    const squadStorage = new InMemorySquadStorage()
    const squadVersions = new InMemorySquadVersionRepository()
    await squadVersions.insert(version('fc26-r10', 1_000))
    const resolved: Club = { ...clubOne, logoUrl: '/api/squads/logos/1' }
    await squadStorage.putClubs('fc26-r10', [resolved])

    let eaCdnBadgeCalls = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/clubs/dark/')) {
        eaCdnBadgeCalls += 1
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      if (url.includes('/leagueLogos/dark/')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }

    const service = new SquadAssetRefreshService({
      config: {},
      fetchImpl,
      logger: new WorkerLogger('test-asset-refresh-hard'),
      squadStorage,
      squadVersions,
    })

    // First, soft mode: nothing should happen (short-circuit).
    await service.refreshLogos({ mode: 'soft' })
    expect(eaCdnBadgeCalls).toBe(0)

    // Hard mode: discovery runs and the badge is refetched. Two calls per
    // club: one EA CDN check in Phase 0 + one byte download during caching.
    const result = await service.refreshLogos({ mode: 'hard' })
    expect(eaCdnBadgeCalls).toBe(2)
    expect(result.matchedClubCount).toBe(1)
  })
})
