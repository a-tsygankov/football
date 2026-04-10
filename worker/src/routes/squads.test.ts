import { describe, expect, it } from 'vitest'
import type { Club, FcPlayer, SquadDiff, SquadVersion } from '@fc26/shared'
import { buildApp } from '../app.js'
import type { Env } from '../env.js'
import { InMemorySquadStorage } from '../squad/in-memory-storage.js'
import { InMemorySquadVersionRepository } from '../squad/version-repository.js'

const env: Env = {
  WORKER_VERSION: '0.1.0-test',
  SCHEMA_VERSION: '1',
  MIN_CLIENT_VERSION: '0.1.0',
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
  logoUrl: 'https://r2.example/logos/1.png',
  starRating: 5,
}

const player: FcPlayer = {
  id: 100,
  clubId: 1,
  name: 'Erling Haaland',
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
  const app = buildApp({
    dependencies: () => ({ squadStorage, squadVersions }),
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
})
