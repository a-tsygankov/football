import { describe, expect, it } from 'vitest'
import {
  ROOM_SESSION_HEADER,
  type RefreshRoomSquadAssetsResponse,
  type ResetRoomSquadsResponse,
  type RetrieveRoomSquadsResponse,
  type RoomBootstrapResponse,
  type RoomScoreboardResponse,
} from '@fc26/shared'
import { buildApp } from '../app.js'
import {
  InMemoryPinAttemptRepository,
} from '../auth/pin-attempt-repository.js'
import type { Env } from '../env.js'
import { InMemoryGameEventRepository } from '../events/repository.js'
import { InMemoryGamerRepository } from '../gamers/repository.js'
import { InMemoryGameRepository } from '../games/repository.js'
import { InMemoryGameNightRepository } from '../game-nights/repository.js'
import { InMemoryGameProjectionRepository } from '../projections/repository.js'
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

function buildTestApp() {
  const rooms = new InMemoryRoomRepository()
  const gamers = new InMemoryGamerRepository()
  const games = new InMemoryGameRepository()
  const events = new InMemoryGameEventRepository()
  const projections = new InMemoryGameProjectionRepository()
  const gameNights = new InMemoryGameNightRepository()
  const pinAttempts = new InMemoryPinAttemptRepository()
  const squadStorage = new InMemorySquadStorage()
  const squadVersions = new InMemorySquadVersionRepository()
  const app = buildApp({
    dependencies: () => ({
      rooms,
      gamers,
      games,
      events,
      projections,
      gameNights,
      pinAttempts,
      squadStorage,
      squadVersions,
    }),
  })
  return Object.assign(app, {
    squadStorage,
    squadVersions,
  })
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie')
  expect(raw).toBeTruthy()
  return raw!.split(';')[0]!
}

describe('room routes', () => {
  it('creates a room, sets a cookie, and allows bootstrap with that cookie', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Friday Night', avatarUrl: null }),
      }),
      env,
      execCtx(),
    )

    expect(createRes.status).toBe(201)
    const body = (await createRes.json()) as RoomBootstrapResponse
    expect(body.room.name).toBe('Friday Night')
    expect(body.room.hasPin).toBe(false)
    expect(body.gamers).toEqual([])
    expect(body.currentGame).toBeNull()
    expect(body.session.token).toBeTruthy()

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${body.room.id}/bootstrap`, {
        headers: { Cookie: cookieFrom(createRes) },
      }),
      env,
      execCtx(),
    )

    expect(bootstrapRes.status).toBe(200)
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.room.id).toBe(body.room.id)
    expect(bootstrap.currentGame).toBeNull()
  })

  it('accepts the room session token through the explicit session header', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Header Room' }),
      }),
      env,
      execCtx(),
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as RoomBootstrapResponse
    expect(created.session.token).toBeTruthy()

    const gamerRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
        body: JSON.stringify({ name: 'Alice' }),
      }),
      env,
      execCtx(),
    )
    expect(gamerRes.status).toBe(201)

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/bootstrap`, {
        headers: {
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
      }),
      env,
      execCtx(),
    )
    expect(bootstrapRes.status).toBe(200)
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.gamers).toHaveLength(1)
    expect(bootstrap.session.token).toBe(created.session.token)
  })

  it('updates the room squad platform from settings', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Platform Room' }),
      }),
      env,
      execCtx(),
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as RoomBootstrapResponse
    expect(created.room.squadPlatform).toBe('PS5')

    const updateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/settings`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
        body: JSON.stringify({ squadPlatform: 'XBSX' }),
      }),
      env,
      execCtx(),
    )
    expect(updateRes.status).toBe(200)
    expect(await updateRes.json()).toEqual({
      room: expect.objectContaining({
        id: created.room.id,
        squadPlatform: 'XBSX',
      }),
    })

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/bootstrap`, {
        headers: {
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
      }),
      env,
      execCtx(),
    )
    expect(bootstrapRes.status).toBe(200)
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.room.squadPlatform).toBe('XBSX')
  })

  it('refreshes squad assets from the room settings route', async () => {
    const app = buildTestApp()
    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Settings Room' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse
    await app.squadVersions.insert({
      version: 'fc26-r11',
      releasedAt: null,
      ingestedAt: 2_000,
      clubsBytes: 1,
      clubCount: 1,
      playerCount: 0,
      sourceUrl: 'https://example.com',
      notes: null,
    })
    await app.squadStorage.putClubs('fc26-r11', [
      {
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
        logoUrl: 'https://placeholder.example/arsenal.png',
        starRating: 4,
      },
    ])

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input) => {
      const url = String(input)
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
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    try {
      const refreshRes = await app.fetch(
        new Request(`http://localhost/api/rooms/${created.room.id}/settings/squad-assets/refresh`, {
          method: 'POST',
          headers: {
            [ROOM_SESSION_HEADER]: created.session.token!,
          },
        }),
        env,
        execCtx(),
      )
      expect(refreshRes.status).toBe(200)
      const body = (await refreshRes.json()) as RefreshRoomSquadAssetsResponse
      expect(body.result.status).toBe('refreshed')
      const updated = await app.squadStorage.getClubs('fc26-r11')
      expect(updated?.[0]?.logoUrl).toBe('https://assets.example/teams/arsenal.png')
      expect(updated?.[0]?.leagueLogoUrl).toBe('https://assets.example/leagues/epl.png')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retrieves squad clubs and players from settings', async () => {
    const app = buildTestApp()
    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Sync Room' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input) => {
      const url = String(input)
      if (
        url ===
        'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml'
      ) {
        return new Response(
          '<root><squadInfo platform="PS5"><dbMajor>fc26-r12</dbMajor></squadInfo></root>',
          {
            headers: { 'content-type': 'application/xml' },
          },
        )
      }
      if (url === 'https://YOUR-SNAPSHOT-HOST/PS5/fc26-r12.json') {
        return Response.json({
          version: 'fc26-r12',
          releasedAt: 1_710_000_000_000,
          clubs: [
            {
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
              logoUrl: 'https://placeholder.example/arsenal.png',
              starRating: 4,
            },
          ],
          players: [
            {
              id: 100,
              clubId: 1,
              name: 'Bukayo Saka',
              avatarUrl: null,
              position: 'RW',
              nationId: 14,
              overall: 89,
              attributes: {
                pace: 90,
                shooting: 84,
                passing: 83,
                dribbling: 90,
                defending: 60,
                physical: 72,
              },
            },
          ],
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    try {
      const retrieveRes = await app.fetch(
        new Request(`http://localhost/api/rooms/${created.room.id}/settings/squads/retrieve`, {
          method: 'POST',
          headers: {
            [ROOM_SESSION_HEADER]: created.session.token!,
          },
        }),
        env,
        execCtx(),
      )
      expect(retrieveRes.status).toBe(200)
      const body = (await retrieveRes.json()) as RetrieveRoomSquadsResponse
      expect(body.result.status).toBe('ingested')
      expect((await app.squadVersions.latest())?.version).toBe('fc26-r12')
      expect(await app.squadStorage.getPlayersForClub('fc26-r12', 1)).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces manual squad retrieval failures as a 502 with the upstream message', async () => {
    const app = buildTestApp()
    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Broken Sync Room' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('snapshot fetch failed with status 404')
    }) as typeof fetch

    try {
      const retrieveRes = await app.fetch(
        new Request(`http://localhost/api/rooms/${created.room.id}/settings/squads/retrieve`, {
          method: 'POST',
          headers: {
            [ROOM_SESSION_HEADER]: created.session.token!,
          },
        }),
        env,
        execCtx(),
      )
      expect(retrieveRes.status).toBe(502)
      expect(await retrieveRes.json()).toEqual({
        error: 'squad_sync_failed',
        message: 'snapshot fetch failed with status 404',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fully resets stored squad data from settings', async () => {
    const app = buildTestApp()
    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Reset Room' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse
    await app.squadVersions.insert({
      version: 'fc26-r10',
      releasedAt: null,
      ingestedAt: 1_000,
      clubsBytes: 1,
      clubCount: 1,
      playerCount: 0,
      sourceUrl: 'https://example.com',
      notes: null,
    })
    await app.squadStorage.putClubs('fc26-r10', [
      {
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
        logoUrl: 'https://placeholder.example/arsenal.png',
        starRating: 4,
      },
    ])
    await app.squadStorage.setLatestVersion('fc26-r10')

    const resetRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/settings/squads/reset`, {
        method: 'POST',
        headers: {
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
      }),
      env,
      execCtx(),
    )
    expect(resetRes.status).toBe(200)
    const body = (await resetRes.json()) as ResetRoomSquadsResponse
    expect(body.result.status).toBe('reset')
    expect(body.result.deletedVersionCount).toBe(1)
    expect(await app.squadVersions.latest()).toBeNull()
    expect(await app.squadStorage.getLatestVersion()).toBeNull()
    expect(await app.squadStorage.getClubs('fc26-r10')).toBeNull()
  })

  it('rejects a wrong PIN and accepts the correct one', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Locked Room', pin: '1234' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse

    const wrongPinRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '9999' }),
      }),
      env,
      execCtx(),
    )
    expect(wrongPinRes.status).toBe(401)

    const correctPinRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '1234' }),
      }),
      env,
      execCtx(),
    )
    expect(correctPinRes.status).toBe(200)
    expect(correctPinRes.headers.get('set-cookie')).toContain('fc26_room_session=')
  })

  it('joins a room by case-insensitive room name lookup', async () => {
    const app = buildTestApp()

    await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Sunday Ladder' }),
      }),
      env,
      execCtx(),
    )

    const joinRes = await app.fetch(
      new Request('http://localhost/api/rooms/sunday-ladder/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: 'SUNDAY ladder' }),
      }),
      env,
      execCtx(),
    )

    expect(joinRes.status).toBe(200)
    const joined = (await joinRes.json()) as RoomBootstrapResponse
    expect(joined.room.name).toBe('Sunday Ladder')
  })

  it('rejects duplicate room names and protects gamer edits with gamer PINs', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Friday Night' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const duplicateRoomRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: ' friday-night ' }),
      }),
      env,
      execCtx(),
    )
    expect(duplicateRoomRes.status).toBe(409)

    const gamerRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'Alice', pin: '1234' }),
      }),
      env,
      execCtx(),
    )
    expect(gamerRes.status).toBe(201)
    const gamer = (await gamerRes.json()) as { gamer: { id: string; hasPin: boolean } }
    expect(gamer.gamer.hasPin).toBe(true)

    const duplicateGamerRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'aLi ce' }),
      }),
      env,
      execCtx(),
    )
    expect(duplicateGamerRes.status).toBe(409)

    const noPinUpdateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamer.gamer.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ rating: 4 }),
      }),
      env,
      execCtx(),
    )
    expect(noPinUpdateRes.status).toBe(401)

    const pinUpdateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamer.gamer.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ rating: 4, currentPin: '1234', pin: '' }),
      }),
      env,
      execCtx(),
    )
    expect(pinUpdateRes.status).toBe(200)
    const updated = (await pinUpdateRes.json()) as { gamer: { rating: number; hasPin: boolean } }
    expect(updated.gamer.rating).toBe(4)
    expect(updated.gamer.hasPin).toBe(false)
  })

  it('shares a single stem namespace between rooms and gamers', async () => {
    const app = buildTestApp()

    const createRoomRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Shared Stem' }),
      }),
      env,
      execCtx(),
    )
    expect(createRoomRes.status).toBe(201)
    const created = (await createRoomRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRoomRes)

    const gamerConflictRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'shared-stem' }),
      }),
      env,
      execCtx(),
    )
    expect(gamerConflictRes.status).toBe(409)

    const gamerRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'Player Stem' }),
      }),
      env,
      execCtx(),
    )
    expect(gamerRes.status).toBe(201)

    const roomConflictRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'player stem' }),
      }),
      env,
      execCtx(),
    )
    expect(roomConflictRes.status).toBe(409)
  })

  it('creates gamers and starts a game night', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Roster Room' }),
      }),
      env,
      execCtx(),
    )
    const body = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerARes = await app.fetch(
      new Request(`http://localhost/api/rooms/${body.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'Alice', rating: 5 }),
      }),
      env,
      execCtx(),
    )
    expect(gamerARes.status).toBe(201)
    const gamerA = (await gamerARes.json()) as { gamer: { id: string } }

    const gamerBRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${body.room.id}/gamers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ name: 'Bob', rating: 4 }),
      }),
      env,
      execCtx(),
    )
    expect(gamerBRes.status).toBe(201)
    const gamerB = (await gamerBRes.json()) as { gamer: { id: string } }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${body.room.id}/game-nights`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ activeGamerIds: [gamerA.gamer.id, gamerB.gamer.id] }),
      }),
      env,
      execCtx(),
    )
    expect(gameNightRes.status).toBe(201)

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${body.room.id}/bootstrap`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.gamers).toHaveLength(2)
    expect(bootstrap.activeGameNight).toBeTruthy()
    expect(bootstrap.activeGameNightGamers).toHaveLength(2)
    expect(bootstrap.currentGame).toBeNull()
  })

  it('updates active gamers and creates a manual current game', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Manual Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerIds: string[] = []
    for (const name of ['Alice', 'Bob', 'Cara', 'Dylan']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { gamer: { id: string } }
      gamerIds.push(body.gamer.id)
    }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )
    expect(gameNightRes.status).toBe(201)
    const gameNightBody = (await gameNightRes.json()) as { gameNight: { id: string } }

    const updateActiveRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/active-gamers`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ activeGamerIds: gamerIds.slice(0, 3) }),
        },
      ),
      env,
      execCtx(),
    )
    expect(updateActiveRes.status).toBe(200)

    const currentGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({
            allocationMode: 'manual',
            homeGamerIds: [gamerIds[0], gamerIds[1]],
            awayGamerIds: [gamerIds[2]],
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(currentGameRes.status).toBe(201)
    const currentGameBody = (await currentGameRes.json()) as {
      currentGame: { format: string }
    }
    expect(currentGameBody.currentGame.format).toBe('2v1')

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/bootstrap`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.activeGameNightGamers).toHaveLength(3)
    expect(bootstrap.currentGame?.format).toBe('2v1')
  })

  it('creates a random current game using the requested format', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Random Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerIds: string[] = []
    for (const name of ['Alice', 'Bob', 'Cara', 'Dylan']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { gamer: { id: string } }
      gamerIds.push(body.gamer.id)
    }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )
    expect(gameNightRes.status).toBe(201)
    const gameNightBody = (await gameNightRes.json()) as { gameNight: { id: string } }

    const currentGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({
            allocationMode: 'random',
            format: '2v2',
            selectionStrategyId: 'uniform-random',
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(currentGameRes.status).toBe(201)
    const currentGameBody = (await currentGameRes.json()) as {
      currentGame: {
        allocationMode: string
        format: string
        homeGamerIds: string[]
        awayGamerIds: string[]
      }
    }
    expect(currentGameBody.currentGame.allocationMode).toBe('random')
    expect(currentGameBody.currentGame.format).toBe('2v2')
    expect(currentGameBody.currentGame.homeGamerIds).toHaveLength(2)
    expect(currentGameBody.currentGame.awayGamerIds).toHaveLength(2)
  })

  it('records and interrupts active games so the next game can be created', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Result Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerIds: string[] = []
    for (const name of ['Alice', 'Bob', 'Cara', 'Dylan']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { gamer: { id: string } }
      gamerIds.push(body.gamer.id)
    }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )
    expect(gameNightRes.status).toBe(201)
    const gameNightBody = (await gameNightRes.json()) as { gameNight: { id: string } }

    const firstGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({
            allocationMode: 'manual',
            homeGamerIds: gamerIds.slice(0, 2),
            awayGamerIds: gamerIds.slice(2, 4),
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(firstGameRes.status).toBe(201)
    const firstGameBody = (await firstGameRes.json()) as { currentGame: { id: string } }

    const recordRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${firstGameBody.currentGame.id}/result`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ result: 'home', homeScore: 2, awayScore: 1 }),
        },
      ),
      env,
      execCtx(),
    )
    expect(recordRes.status).toBe(200)
    const recorded = (await recordRes.json()) as {
      currentGame: null
      eventType: string
      activeGameNight: { lastGameAt: number | null }
    }
    expect(recorded.currentGame).toBeNull()
    expect(recorded.eventType).toBe('game_recorded')
    expect(recorded.activeGameNight.lastGameAt).toBeTruthy()

    const secondGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({
            allocationMode: 'random',
            format: '2v2',
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(secondGameRes.status).toBe(201)
    const secondGameBody = (await secondGameRes.json()) as { currentGame: { id: string } }

    const interruptRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${secondGameBody.currentGame.id}/interrupt`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ comment: 'Controller battery died' }),
        },
      ),
      env,
      execCtx(),
    )
    expect(interruptRes.status).toBe(200)
    const interrupted = (await interruptRes.json()) as {
      currentGame: null
      eventType: string
    }
    expect(interrupted.currentGame).toBeNull()
    expect(interrupted.eventType).toBe('game_interrupted')

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/bootstrap`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.currentGame).toBeNull()
    expect(bootstrap.activeGameNight).toBeTruthy()
  })

  it('returns gamer and gamer-team scoreboards for recorded games', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Scoreboard Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerIds: string[] = []
    for (const name of ['Alice', 'Bob', 'Cara', 'Dylan']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { gamer: { id: string } }
      gamerIds.push(body.gamer.id)
    }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )
    expect(gameNightRes.status).toBe(201)
    const gameNightBody = (await gameNightRes.json()) as { gameNight: { id: string } }

    const currentGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({
            allocationMode: 'manual',
            homeGamerIds: gamerIds.slice(0, 2),
            awayGamerIds: gamerIds.slice(2, 4),
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(currentGameRes.status).toBe(201)
    const currentGameBody = (await currentGameRes.json()) as { currentGame: { id: string } }

    const recordRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${currentGameBody.currentGame.id}/result`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ result: 'home', homeScore: 3, awayScore: 1 }),
        },
      ),
      env,
      execCtx(),
    )
    expect(recordRes.status).toBe(200)

    const scoreboardRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/scoreboard`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    expect(scoreboardRes.status).toBe(200)
    const scoreboard = (await scoreboardRes.json()) as RoomScoreboardResponse
    expect(scoreboard.gamerRows).toHaveLength(4)
    expect(scoreboard.gamerTeamRows).toHaveLength(2)
    expect(scoreboard.gamerRows.find((row) => row.gamer.name === 'Alice')?.points).toBe(3)
    const aliceBobTeam = scoreboard.gamerTeamRows.find((row) => {
      const memberNames = new Set(row.members.map((member) => member.name))
      return memberNames.has('Alice') && memberNames.has('Bob')
    })
    expect(aliceBobTeam?.points).toBe(3)
  })
})
