import { describe, expect, it } from 'vitest'
import type { Club, FcPlayer, SquadDiff, SquadVersion } from '@fc26/shared'
import { buildApp } from '../app.js'
import {
  InMemoryPinAttemptRepository,
} from '../auth/pin-attempt-repository.js'
import type { Env } from '../env.js'
import { InMemoryGamerRepository } from '../gamers/repository.js'
import { InMemoryGameRepository } from '../games/repository.js'
import { InMemoryGameNightRepository } from '../game-nights/repository.js'
import { InMemoryRoomRepository } from '../rooms/repository.js'
import { InMemorySquadStorage } from '../squad/in-memory-storage.js'
import { InMemorySquadVersionRepository } from '../squad/version-repository.js'

const env: Env = {
  WORKER_VERSION: '0.1.0-test',
  SCHEMA_VERSION: '1',
  MIN_CLIENT_VERSION: '0.1.0',
  SESSION_SECRET: 'test-session-secret',
}

function execCtx(): ExecutionContext {
  return {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext
}

const club: Club = {
  id: 1,
  name: 'Manchester City',
  shortName: 'MCI',
  leagueId: 13,
  leagueName: 'Premier League',
  nationId: 14,
  overallRating: 89,
  attackRating: 88,
  midfieldRating: 90,
  defenseRating: 87,
  avatarUrl: null,
  logoUrl: 'https://r2.example/logos/1.png',
  starRating: 5,
}

const player: FcPlayer = {
  id: 100,
  clubId: 1,
  name: 'Erling Haaland',
  avatarUrl: null,
  position: 'ST',
  nationId: 36,
  overall: 91,
  attributes: {
    pace: 89,
    shooting: 94,
    passing: 65,
    dribbling: 80,
    defending: 45,
    physical: 88,
  },
}

function makeVersion(version: string, ingestedAt: number): SquadVersion {
  return {
    version,
    releasedAt: null,
    ingestedAt,
    clubsBytes: 1,
    clubCount: 1,
    playerCount: 1,
    sourceUrl: 'https://example.com',
    notes: null,
  }
}

function buildTestApp() {
  const squadStorage = new InMemorySquadStorage()
  const squadVersions = new InMemorySquadVersionRepository()
  const rooms = new InMemoryRoomRepository()
  const gamers = new InMemoryGamerRepository()
  const games = new InMemoryGameRepository()
  const gameNights = new InMemoryGameNightRepository()
  const pinAttempts = new InMemoryPinAttemptRepository()
  const app = buildApp({
    dependencies: () => ({
      rooms,
      gamers,
      games,
      gameNights,
      pinAttempts,
      squadStorage,
      squadVersions,
    }),
  })
  return { app, squadStorage, squadVersions }
}

describe('squad routes', () => {
  it('GET /api/squads/versions returns the registry', async () => {
    const { app, squadVersions } = buildTestApp()
    await squadVersions.insert(makeVersion('fc26-r10', 1_000))
    await squadVersions.insert(makeVersion('fc26-r11', 2_000))

    const res = await app.fetch(
      new Request('http://localhost/api/squads/versions'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { versions: SquadVersion[] }
    expect(body.versions.map((v) => v.version)).toEqual(['fc26-r11', 'fc26-r10'])
  })

  it('GET /api/squads/latest returns 503 when no version is ingested', async () => {
    const { app } = buildTestApp()
    const res = await app.fetch(
      new Request('http://localhost/api/squads/latest'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(503)
  })

  it('GET /api/squads/latest returns clubs for the most recent version', async () => {
    const { app, squadStorage, squadVersions } = buildTestApp()
    await squadVersions.insert(makeVersion('fc26-r10', 1_000))
    await squadVersions.insert(makeVersion('fc26-r11', 2_000))
    await squadStorage.putClubs('fc26-r11', [club])

    const res = await app.fetch(
      new Request('http://localhost/api/squads/latest'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: string; clubs: Club[] }
    expect(body.version).toBe('fc26-r11')
    expect(body.clubs).toEqual([club])
  })

  it('GET /api/squads/latest returns 500 when registry and storage are out of sync', async () => {
    const { app, squadVersions } = buildTestApp()
    await squadVersions.insert(makeVersion('fc26-r10', 1_000))
    // No clubs in storage.
    const res = await app.fetch(
      new Request('http://localhost/api/squads/latest'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(500)
  })

  it('GET /api/squads/:version/clubs serves a specific version', async () => {
    const { app, squadStorage } = buildTestApp()
    await squadStorage.putClubs('fc26-r10', [club])
    const res = await app.fetch(
      new Request('http://localhost/api/squads/fc26-r10/clubs'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: string; clubs: Club[] }
    expect(body.version).toBe('fc26-r10')
    expect(body.clubs).toEqual([club])
  })

  it('GET /api/squads/:version/leagues derives league rows from clubs', async () => {
    const { app, squadStorage } = buildTestApp()
    await squadStorage.putClubs('fc26-r10', [
      { ...club, leagueLogoUrl: 'https://r2.example/leagues/13.png' },
      {
        ...club,
        id: 2,
        name: 'Arsenal',
        shortName: 'ARS',
        logoUrl: 'https://r2.example/logos/2.png',
      },
    ])
    const res = await app.fetch(
      new Request('http://localhost/api/squads/fc26-r10/leagues'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      version: string
      leagues: Array<{ id: number; name: string; logoUrl: string | null; clubCount: number }>
    }
    expect(body.version).toBe('fc26-r10')
    expect(body.leagues).toEqual([
      {
        id: 13,
        name: 'Premier League',
        logoUrl: 'https://r2.example/leagues/13.png',
        clubCount: 2,
        nationId: 14,
        gender: 'men',
        countryName: 'England',
      },
    ])
  })

  it('GET /api/squads/:version/clubs returns 404 for unknown version', async () => {
    const { app } = buildTestApp()
    const res = await app.fetch(
      new Request('http://localhost/api/squads/fc26-r99/clubs'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(404)
  })

  it('GET /api/squads/:version/players/:clubId serves players for a club', async () => {
    const { app, squadStorage } = buildTestApp()
    await squadStorage.putPlayersForClub('fc26-r10', 1, [player])
    const res = await app.fetch(
      new Request('http://localhost/api/squads/fc26-r10/players/1'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { players: FcPlayer[] }
    expect(body.players).toEqual([player])
  })

  it('GET /api/squads/:version/players/:clubId rejects non-numeric club id', async () => {
    const { app } = buildTestApp()
    const res = await app.fetch(
      new Request('http://localhost/api/squads/fc26-r10/players/foo'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(400)
  })

  it('GET /api/squads/:version/diff serves a precomputed diff with from query', async () => {
    const { app, squadStorage } = buildTestApp()
    const diff: SquadDiff = {
      fromVersion: 'fc26-r10',
      toVersion: 'fc26-r11',
      generatedAt: 1_700_000_000_000,
      playerChanges: [],
      clubChanges: [],
      addedPlayers: [],
      removedPlayers: [],
    }
    await squadStorage.putDiff(diff)
    const res = await app.fetch(
      new Request(
        'http://localhost/api/squads/fc26-r11/diff?from=fc26-r10',
      ),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SquadDiff
    expect(body).toEqual(diff)
  })

  it('GET /api/squads/:version/diff requires from query', async () => {
    const { app } = buildTestApp()
    const res = await app.fetch(
      new Request('http://localhost/api/squads/fc26-r11/diff'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(400)
  })

  it('GET /api/squads/logos/:clubId serves cached badge bytes when present', async () => {
    const { app, squadStorage } = buildTestApp()
    await squadStorage.putLogoBytes(1, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      contentType: 'image/png',
      sourceUrl: 'https://cdn.example/badges/1.png',
    })
    const res = await app.fetch(
      new Request('http://localhost/api/squads/logos/1'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('GET /api/squads/logos/:clubId returns an SVG initials fallback when no bytes are cached', async () => {
    // No squad version ingested at all — the route should still return a
    // usable SVG using the numeric id, so callers never get a broken image.
    const { app } = buildTestApp()
    const res = await app.fetch(
      new Request('http://localhost/api/squads/logos/42'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    const body = await res.text()
    expect(body.startsWith('<svg')).toBe(true)
    expect(body).toContain('#42')
  })

  it('GET /api/squads/logos/:clubId uses club shortName for SVG initials when latest version has the club', async () => {
    const { app, squadStorage, squadVersions } = buildTestApp()
    await squadVersions.insert(makeVersion('fc26-r10', 1_000))
    await squadStorage.putClubs('fc26-r10', [club])
    const res = await app.fetch(
      new Request('http://localhost/api/squads/logos/1'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    const body = await res.text()
    // Manchester City -> shortName 'MCI'
    expect(body).toContain('MCI')
  })

  it('GET /api/squads/logos/:clubId rejects non-numeric club id', async () => {
    const { app } = buildTestApp()
    const res = await app.fetch(
      new Request('http://localhost/api/squads/logos/not-a-number'),
      env,
      execCtx(),
    )
    expect(res.status).toBe(400)
  })
})
