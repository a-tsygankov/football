import { describe, expect, it } from 'vitest'
import {
  EVENT_SCHEMA_VERSION,
  EventId,
  GameId,
  GameNightId,
  GamerId,
  gamerTeamKey,
  type PersistedGameEvent,
  ROOM_SESSION_HEADER,
  type RefreshRoomSquadAssetsResponse,
  type RepairRoomSquadsResponse,
  type ResetRoomSquadsResponse,
  type RetrieveRoomSquadsResponse,
  RoomId,
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
    games,
    events,
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
        // The pending sentinel is the realistic state at refresh time and
        // signals to the service that there's something to resolve (otherwise
        // the short-circuit in `refreshLogos` returns 'noop').
        logoUrl: 'pending:club:1',
        starRating: 4,
      },
    ])

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input) => {
      const url = String(input)
      // EA CDN club badge
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
      // After EA CDN pass, the logo is cached and served from the worker route.
      expect(updated?.[0]?.logoUrl).toBe('/api/squads/logos/1')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('resolves the EA binary URL from the discovery xml during squad retrieval', async () => {
    // The default sync source now reads the EA roster binary directly. We don't
    // hand-roll a valid EA binary fixture here (the parser has its own tests);
    // instead we verify the route hits the discovery URL, then the binary URL
    // resolved from the dbMajorLoc, and surfaces parser failures as 502.
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
    const fetchCalls: string[] = []
    globalThis.fetch = (async (input) => {
      const url = String(input)
      fetchCalls.push(url)
      if (url.endsWith('/rosterupdate.xml')) {
        return new Response(
          '<root><squadInfo platform="PS5"><dbMajor>fc26-r12</dbMajor><dbMajorLoc>fc/fclive/squads/r12.bin</dbMajorLoc></squadInfo></root>',
          { headers: { 'content-type': 'application/xml' } },
        )
      }
      if (url.endsWith('/squads/r12.bin')) {
        // Garbage bytes — the parser will reject, the route should respond 502.
        return new Response(new Uint8Array([0, 1, 2, 3, 4]).buffer, { status: 200 })
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
      expect(retrieveRes.status).toBe(502)
      expect(fetchCalls).toEqual([
        'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/genxtitle/rosterupdate.xml',
        'https://eafc26.content.easports.com/fc/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fc/fclive/squads/r12.bin',
      ])
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

  it('repairs duplicate leagueIds in stored squad versions and is idempotent', async () => {
    const app = buildTestApp()
    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Repair Room' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse
    // Simulate the pre-fix state: the same human league was ingested under
    // two different EA leagueIds (console vs. handheld), so two clubs share
    // 'Premier League' as their leagueName but carry different leagueIds.
    // The canonical id is 13 because it has the larger club count.
    await app.squadVersions.insert({
      version: 'fc26-r11',
      releasedAt: null,
      ingestedAt: 1_000,
      clubsBytes: 1,
      clubCount: 3,
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
        logoUrl: '',
        starRating: 4,
      },
      {
        id: 2,
        name: 'Chelsea',
        shortName: 'CHE',
        leagueId: 13,
        leagueName: 'Premier League',
        nationId: 14,
        overallRating: 83,
        attackRating: 83,
        midfieldRating: 83,
        defenseRating: 80,
        avatarUrl: null,
        logoUrl: '',
        starRating: 4,
      },
      {
        id: 3,
        name: 'Liverpool',
        shortName: 'LIV',
        leagueId: 999,
        leagueName: 'Premier League',
        nationId: 14,
        overallRating: 85,
        attackRating: 85,
        midfieldRating: 85,
        defenseRating: 82,
        avatarUrl: null,
        logoUrl: '',
        starRating: 4,
      },
    ])

    const firstRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/settings/squads/repair`, {
        method: 'POST',
        headers: {
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
      }),
      env,
      execCtx(),
    )
    expect(firstRes.status).toBe(200)
    const firstBody = (await firstRes.json()) as RepairRoomSquadsResponse
    expect(firstBody.result.status).toBe('repaired')
    expect(firstBody.result.versionCount).toBe(1)
    expect(firstBody.result.rewrittenVersionCount).toBe(1)
    expect(firstBody.result.rewrittenClubCount).toBe(1)
    expect(firstBody.result.collapsedLeagueCount).toBe(1)
    expect(firstBody.result.collapsedClubCount).toBe(0)
    expect(firstBody.result.rewrittenGameRowCount).toBe(0)
    expect(firstBody.result.rewrittenEventPayloadCount).toBe(0)

    const storedAfterRepair = await app.squadStorage.getClubs('fc26-r11')
    expect(storedAfterRepair).not.toBeNull()
    for (const club of storedAfterRepair!) {
      expect(club.leagueId).toBe(13)
    }

    // Second run must be a no-op — nothing left to collapse.
    const secondRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${created.room.id}/settings/squads/repair`, {
        method: 'POST',
        headers: {
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
      }),
      env,
      execCtx(),
    )
    expect(secondRes.status).toBe(200)
    const secondBody = (await secondRes.json()) as RepairRoomSquadsResponse
    expect(secondBody.result.status).toBe('noop')
    expect(secondBody.result.rewrittenVersionCount).toBe(0)
    expect(secondBody.result.rewrittenClubCount).toBe(0)
    expect(secondBody.result.collapsedLeagueCount).toBe(0)
    expect(secondBody.result.collapsedClubCount).toBe(0)
    expect(secondBody.result.rewrittenGameRowCount).toBe(0)
    expect(secondBody.result.rewrittenEventPayloadCount).toBe(0)
  })

  it('repairs duplicate clubs and rewrites historical game + event references', async () => {
    const app = buildTestApp()
    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dupes Room' }),
      }),
      env,
      execCtx(),
    )
    const created = (await createRes.json()) as RoomBootstrapResponse
    const roomId = created.room.id
    // Seed a stored squad version where the same club ships under two
    // EA ids (console + handheld) — the classic post-alias duplicate.
    await app.squadVersions.insert({
      version: 'fc26-r20',
      releasedAt: null,
      ingestedAt: 1_000,
      clubsBytes: 1,
      clubCount: 2,
      playerCount: 0,
      sourceUrl: 'https://example.com',
      notes: null,
    })
    await app.squadStorage.putClubs('fc26-r20', [
      {
        id: 100,
        name: 'AC Milan',
        shortName: 'MIL',
        leagueId: 31,
        leagueName: 'Serie A',
        nationId: 27,
        overallRating: 85,
        attackRating: 83,
        midfieldRating: 82,
        defenseRating: 80,
        avatarUrl: null,
        logoUrl: '',
        starRating: 8,
      },
      {
        id: 200,
        name: 'AC Milan',
        shortName: 'MIL',
        leagueId: 31,
        leagueName: 'Serie A',
        nationId: 27,
        overallRating: 84,
        attackRating: 82,
        midfieldRating: 81,
        defenseRating: 79,
        avatarUrl: null,
        logoUrl: '',
        starRating: 7,
      },
    ])
    // History: a recorded game where the home team was the duplicate
    // (id 200). After repair it must point at canonical id 100. We
    // write via the in-memory repo's `create` path, then flip status to
    // bypass the "active game" constraint.
    const gameNightIdValue = GameNightId('gn-dupes-1')
    const recordedGameId = GameId('game-recorded-1')
    await app.games.create({
      id: recordedGameId,
      roomId: RoomId(roomId),
      gameNightId: gameNightIdValue,
      status: 'active',
      allocationMode: 'manual',
      format: '1v1',
      homeGamerIds: [GamerId('gamer-a')],
      awayGamerIds: [GamerId('gamer-b')],
      homeClubId: 200,
      awayClubId: 100,
      selectionStrategyId: 'manual',
      randomSeed: null,
      createdAt: 10,
      updatedAt: 10,
    })
    await app.games.update({
      id: recordedGameId,
      roomId: RoomId(roomId),
      gameNightId: gameNightIdValue,
      status: 'recorded',
      allocationMode: 'manual',
      format: '1v1',
      homeGamerIds: [GamerId('gamer-a')],
      awayGamerIds: [GamerId('gamer-b')],
      homeClubId: 200,
      awayClubId: 100,
      selectionStrategyId: 'manual',
      randomSeed: null,
      createdAt: 10,
      updatedAt: 11,
    })
    // And a corresponding event payload — the `remapClubIdsInPayloads`
    // scope is limited to `game_recorded`, which is what we need.
    const payload: PersistedGameEvent['payload'] = {
      type: 'game_recorded',
      schemaVersion: EVENT_SCHEMA_VERSION,
      gameId: recordedGameId,
      gameNightId: gameNightIdValue,
      roomId: RoomId(roomId),
      format: '1v1',
      size: 2,
      occurredAt: 12,
      home: {
        gamerIds: [GamerId('gamer-a')],
        gamerTeamKey: gamerTeamKey([GamerId('gamer-a')]),
        clubId: 200,
        score: 2,
      },
      away: {
        gamerIds: [GamerId('gamer-b')],
        gamerTeamKey: gamerTeamKey([GamerId('gamer-b')]),
        clubId: 100,
        score: 1,
      },
      result: 'home',
      squadVersion: 'fc26-r20',
      selectionStrategyId: 'manual',
      entryMethod: 'manual',
    }
    await app.events.insert({
      id: EventId('event-1'),
      roomId: RoomId(roomId),
      eventType: 'game_recorded',
      payload,
      schemaVersion: EVENT_SCHEMA_VERSION,
      correlationId: null,
      occurredAt: 12,
      recordedAt: 13,
    })

    const repairRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${roomId}/settings/squads/repair`, {
        method: 'POST',
        headers: {
          [ROOM_SESSION_HEADER]: created.session.token!,
        },
      }),
      env,
      execCtx(),
    )
    expect(repairRes.status).toBe(200)
    const body = (await repairRes.json()) as RepairRoomSquadsResponse
    expect(body.result.status).toBe('repaired')
    expect(body.result.collapsedClubCount).toBe(1)
    expect(body.result.rewrittenGameRowCount).toBe(1)
    expect(body.result.rewrittenEventPayloadCount).toBe(1)

    // clubs.json now has only the higher-rated canonical row.
    const storedClubs = await app.squadStorage.getClubs('fc26-r20')
    expect(storedClubs).toHaveLength(1)
    expect(storedClubs![0]!.id).toBe(100)

    // The stored events now reference the canonical id.
    const events = await app.events.listByRoom(roomId)
    expect(events).toHaveLength(1)
    const rewritten = events[0]!.payload
    expect(rewritten.type).toBe('game_recorded')
    if (rewritten.type === 'game_recorded') {
      expect(rewritten.home.clubId).toBe(100)
      expect(rewritten.away.clubId).toBe(100)
    }
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

  it('adds a gamer created during an active game night to the live pool', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Walk-In Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const initialGamerIds: string[] = []
    for (const name of ['Alice', 'Bob']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { gamer: { id: string } }
      initialGamerIds.push(body.gamer.id)
    }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ activeGamerIds: initialGamerIds }),
      }),
      env,
      execCtx(),
    )
    expect(gameNightRes.status).toBe(201)

    const lateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Cara' }),
      }),
      env,
      execCtx(),
    )
    expect(lateRes.status).toBe(201)
    const lateBody = (await lateRes.json()) as {
      gamer: { id: string }
      activeGameNightGamers?: ReadonlyArray<{ gamerId: string }>
    }
    expect(lateBody.activeGameNightGamers?.map((item) => item.gamerId)).toContain(
      lateBody.gamer.id,
    )

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/bootstrap`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.activeGameNightGamers.map((item) => item.gamerId)).toEqual(
      expect.arrayContaining([...initialGamerIds, lateBody.gamer.id]),
    )
    expect(bootstrap.activeGameNightGamers).toHaveLength(initialGamerIds.length + 1)
  })

  it('does not add an inactive new gamer to the live pool', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Skip Pool Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const initialGamerIds: string[] = []
    for (const name of ['Alice', 'Bob']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      const body = (await res.json()) as { gamer: { id: string } }
      initialGamerIds.push(body.gamer.id)
    }

    await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ activeGamerIds: initialGamerIds }),
      }),
      env,
      execCtx(),
    )

    const inactiveRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Cara', active: false }),
      }),
      env,
      execCtx(),
    )
    expect(inactiveRes.status).toBe(201)
    const inactiveBody = (await inactiveRes.json()) as {
      gamer: { id: string; active: boolean }
      activeGameNightGamers?: ReadonlyArray<{ gamerId: string }>
    }
    expect(inactiveBody.gamer.active).toBe(false)
    expect(inactiveBody.activeGameNightGamers).toBeUndefined()
  })

  it('removes a gamer from the live pool when deactivated from the roster', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Deactivate Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerIds: string[] = []
    for (const name of ['Alice', 'Bob', 'Cara']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      const body = (await res.json()) as { gamer: { id: string } }
      gamerIds.push(body.gamer.id)
    }

    await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )

    const targetGamerId = gamerIds[2]!
    const deactivateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${targetGamerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ active: false }),
      }),
      env,
      execCtx(),
    )
    expect(deactivateRes.status).toBe(200)
    const deactivateBody = (await deactivateRes.json()) as {
      gamer: { id: string; active: boolean }
      activeGameNightGamers?: ReadonlyArray<{ gamerId: string }>
    }
    expect(deactivateBody.gamer.active).toBe(false)
    expect(deactivateBody.activeGameNightGamers?.map((item) => item.gamerId)).not.toContain(
      targetGamerId,
    )

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/bootstrap`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.activeGameNightGamers.map((item) => item.gamerId)).not.toContain(
      targetGamerId,
    )
    expect(bootstrap.gamers.find((gamer) => gamer.id === targetGamerId)?.active).toBe(false)
  })

  it('blocks deactivation when the gamer is in the in-progress game', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Live Game Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerIds: string[] = []
    for (const name of ['Alice', 'Bob']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name }),
        }),
        env,
        execCtx(),
      )
      const body = (await res.json()) as { gamer: { id: string } }
      gamerIds.push(body.gamer.id)
    }

    const gameNightRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )
    const gameNightBody = (await gameNightRes.json()) as { gameNight: { id: string } }

    const currentGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            allocationMode: 'manual',
            homeGamerIds: [gamerIds[0]],
            awayGamerIds: [gamerIds[1]],
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(currentGameRes.status).toBe(201)

    const deactivateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamerIds[0]}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ active: false }),
      }),
      env,
      execCtx(),
    )
    expect(deactivateRes.status).toBe(409)
    const deactivateBody = (await deactivateRes.json()) as { error: string; gamerId: string }
    expect(deactivateBody.error).toBe('gamer_active_in_current_game')
    expect(deactivateBody.gamerId).toBe(gamerIds[0])
  })
})
