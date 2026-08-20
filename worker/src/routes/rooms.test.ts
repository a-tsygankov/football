import { describe, expect, it } from 'vitest'
import {
  EVENT_SCHEMA_VERSION,
  EventId,
  GameId,
  GameNightId,
  GamerId,
  gamerTeamKey,
  type MatchHistoryResponse,
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
import { buildTestApp, cookieFrom, env, execCtx } from './test-support.js'

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
      betsLockedAt: null,
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
      betsLockedAt: null,
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

  it('updates a gamer avatar and preserves it when avatarUrl is omitted', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Avatar Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const gamerRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Avatar Gamer' }),
      }),
      env,
      execCtx(),
    )
    expect(gamerRes.status).toBe(201)
    const gamer = (await gamerRes.json()) as {
      gamer: { id: string; avatarUrl: string | null }
    }
    expect(gamer.gamer.avatarUrl).toBeNull()

    const dataUrl =
      'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73v/+BiOh/AAA='

    // Set the avatar.
    const setRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamer.gamer.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      }),
      env,
      execCtx(),
    )
    expect(setRes.status).toBe(200)
    const withAvatar = (await setRes.json()) as { gamer: { avatarUrl: string | null } }
    expect(withAvatar.gamer.avatarUrl).toBe(dataUrl)

    // Editing another field without sending avatarUrl keeps the existing image.
    const renameRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamer.gamer.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Avatar Player' }),
      }),
      env,
      execCtx(),
    )
    expect(renameRes.status).toBe(200)
    const renamed = (await renameRes.json()) as {
      gamer: { name: string; avatarUrl: string | null }
    }
    expect(renamed.gamer.name).toBe('Avatar Player')
    expect(renamed.gamer.avatarUrl).toBe(dataUrl)

    // Passing null clears the avatar.
    const clearRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamer.gamer.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ avatarUrl: null }),
      }),
      env,
      execCtx(),
    )
    expect(clearRes.status).toBe(200)
    const cleared = (await clearRes.json()) as { gamer: { avatarUrl: string | null } }
    expect(cleared.gamer.avatarUrl).toBeNull()
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

  it('adds a reactivated gamer back to the live pool', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Reactivate Room' }),
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

    // Add a third inactive gamer from the start — not in the pool when the
    // game night starts.
    const inactiveRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Cara', active: false }),
      }),
      env,
      execCtx(),
    )
    const inactiveBody = (await inactiveRes.json()) as { gamer: { id: string } }
    const caraId = inactiveBody.gamer.id

    await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )

    const reactivateRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${caraId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ active: true }),
      }),
      env,
      execCtx(),
    )
    expect(reactivateRes.status).toBe(200)
    const reactivateBody = (await reactivateRes.json()) as {
      gamer: { id: string; active: boolean }
      activeGameNightGamers?: ReadonlyArray<{ gamerId: string }>
    }
    expect(reactivateBody.gamer.active).toBe(true)
    expect(reactivateBody.activeGameNightGamers?.map((item) => item.gamerId)).toContain(
      caraId,
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
      expect.arrayContaining([...gamerIds, caraId]),
    )
  })

  it('does not duplicate a gamer in the pool on an idempotent reactivation', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Idempotent Room' }),
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

    await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/game-nights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ activeGamerIds: gamerIds }),
      }),
      env,
      execCtx(),
    )

    // PATCH with active: true on an already-active gamer must be a no-op
    // for the pool — no duplicate rows, no surprise response field.
    const noopRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/gamers/${gamerIds[0]}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ active: true }),
      }),
      env,
      execCtx(),
    )
    expect(noopRes.status).toBe(200)
    const noopBody = (await noopRes.json()) as {
      gamer: { id: string }
      activeGameNightGamers?: ReadonlyArray<{ gamerId: string }>
    }
    expect(noopBody.activeGameNightGamers).toBeUndefined()

    const bootstrapRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/bootstrap`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const bootstrap = (await bootstrapRes.json()) as RoomBootstrapResponse
    expect(bootstrap.activeGameNightGamers).toHaveLength(gamerIds.length)
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

  it('returns per-gamer match history with resolved clubs and scores', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'History Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    await app.squadVersions.insert({
      version: 'fc26-r11',
      releasedAt: null,
      ingestedAt: 2_000,
      clubsBytes: 1,
      clubCount: 2,
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
        logoUrl: 'pending:club:1',
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
        defenseRating: 81,
        avatarUrl: null,
        logoUrl: 'pending:club:2',
        starRating: 4,
      },
    ])

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
    const [aliceId, bobId] = gamerIds

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
            homeGamerIds: [aliceId],
            awayGamerIds: [bobId],
            homeClubId: 1,
            awayClubId: 2,
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
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ result: 'home', homeScore: 2, awayScore: 1 }),
        },
      ),
      env,
      execCtx(),
    )
    expect(recordRes.status).toBe(200)

    const historyRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/match-history?gamerId=${aliceId}`,
        { headers: { Cookie: cookie } },
      ),
      env,
      execCtx(),
    )
    expect(historyRes.status).toBe(200)
    const history = (await historyRes.json()) as MatchHistoryResponse
    expect(history.matches).toHaveLength(1)
    const match = history.matches[0]!
    expect(match.result).toBe('home')
    expect(match.home.gamers.map((g) => g.name)).toEqual(['Alice'])
    expect(match.home.clubName).toBe('Arsenal')
    expect(match.home.score).toBe(2)
    expect(match.home.won).toBe(true)
    expect(match.away.gamers.map((g) => g.name)).toEqual(['Bob'])
    expect(match.away.clubName).toBe('Chelsea')
    expect(match.away.score).toBe(1)
    expect(match.away.won).toBe(false)
  })

  it('returns per-team match history filtered by gamer-team key', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Team History Room' }),
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
            homeGamerIds: gamerIds.slice(0, 2),
            awayGamerIds: gamerIds.slice(2, 4),
          }),
        },
      ),
      env,
      execCtx(),
    )
    const currentGameBody = (await currentGameRes.json()) as { currentGame: { id: string } }

    await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${currentGameBody.currentGame.id}/result`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ result: 'home', homeScore: 4, awayScore: 2 }),
        },
      ),
      env,
      execCtx(),
    )

    const teamKey = gamerTeamKey([
      GamerId(gamerIds[0]!),
      GamerId(gamerIds[1]!),
    ])
    const historyRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/match-history?teamKey=${encodeURIComponent(teamKey)}`,
        { headers: { Cookie: cookie } },
      ),
      env,
      execCtx(),
    )
    expect(historyRes.status).toBe(200)
    const history = (await historyRes.json()) as MatchHistoryResponse
    expect(history.matches).toHaveLength(1)
    const match = history.matches[0]!
    expect(new Set(match.home.gamers.map((g) => g.name))).toEqual(new Set(['Alice', 'Bob']))
    expect(match.home.score).toBe(4)
    expect(match.away.score).toBe(2)
    expect(match.home.won).toBe(true)
  })

  it('returns all recorded matches for the room with scope=all', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'All Games Room' }),
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
    const [aliceId, bobId, caraId] = gamerIds

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
    const gameNightId = gameNightBody.gameNight.id

    const recordSoloGame = async (
      homeGamerId: string,
      awayGamerId: string,
    ): Promise<void> => {
      const gameRes = await app.fetch(
        new Request(
          `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightId}/games`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
              allocationMode: 'manual',
              homeGamerIds: [homeGamerId],
              awayGamerIds: [awayGamerId],
              homeClubId: 1,
              awayClubId: 2,
            }),
          },
        ),
        env,
        execCtx(),
      )
      const gameBody = (await gameRes.json()) as { currentGame: { id: string } }
      const resultRes = await app.fetch(
        new Request(
          `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightId}/games/${gameBody.currentGame.id}/result`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ result: 'home', homeScore: 1, awayScore: 0 }),
          },
        ),
        env,
        execCtx(),
      )
      expect(resultRes.status).toBe(200)
    }

    await recordSoloGame(aliceId!, bobId!)
    await recordSoloGame(bobId!, caraId!)

    const allRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/match-history?scope=all`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    expect(allRes.status).toBe(200)
    const all = (await allRes.json()) as MatchHistoryResponse
    expect(all.matches).toHaveLength(2)

    // A per-gamer scope still narrows the same data set.
    const aliceRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/match-history?gamerId=${aliceId}`,
        { headers: { Cookie: cookie } },
      ),
      env,
      execCtx(),
    )
    const alice = (await aliceRes.json()) as MatchHistoryResponse
    expect(alice.matches).toHaveLength(1)
  })

  it('voids a recorded game and rolls back scoreboard + match history', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Void Room' }),
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
    const [aliceId, bobId] = gamerIds

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
            homeGamerIds: [aliceId],
            awayGamerIds: [bobId],
          }),
        },
      ),
      env,
      execCtx(),
    )
    const currentGameBody = (await currentGameRes.json()) as { currentGame: { id: string } }
    const gameId = currentGameBody.currentGame.id

    await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${gameId}/result`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ result: 'home', homeScore: 2, awayScore: 1 }),
        },
      ),
      env,
      execCtx(),
    )

    // Confirm baseline: the match is in history and Alice has a win.
    const beforeHistory = (await (
      await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/match-history?scope=all`, {
          headers: { Cookie: cookie },
        }),
        env,
        execCtx(),
      )
    ).json()) as MatchHistoryResponse
    expect(beforeHistory.matches).toHaveLength(1)
    const beforeBoard = (await (
      await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/scoreboard`, {
          headers: { Cookie: cookie },
        }),
        env,
        execCtx(),
      )
    ).json()) as RoomScoreboardResponse
    const aliceBefore = beforeBoard.gamerRows.find((row) => row.gamer.id === aliceId)
    expect(aliceBefore?.stats.wins).toBe(1)

    // Void the game.
    const voidRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${gameId}/void`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ reason: 'admin_delete' }),
        },
      ),
      env,
      execCtx(),
    )
    expect(voidRes.status).toBe(200)

    // Match history no longer surfaces the voided game.
    const afterHistory = (await (
      await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/match-history?scope=all`, {
          headers: { Cookie: cookie },
        }),
        env,
        execCtx(),
      )
    ).json()) as MatchHistoryResponse
    expect(afterHistory.matches).toHaveLength(0)

    // Scoreboard projections were reversed.
    const afterBoard = (await (
      await app.fetch(
        new Request(`http://localhost/api/rooms/${room.room.id}/scoreboard`, {
          headers: { Cookie: cookie },
        }),
        env,
        execCtx(),
      )
    ).json()) as RoomScoreboardResponse
    const aliceAfter = afterBoard.gamerRows.find((row) => row.gamer.id === aliceId)
    // Either the row was zeroed out or filtered (depending on projection
    // pruning); the win count must be back to 0 either way.
    expect(aliceAfter?.stats.wins ?? 0).toBe(0)

    // Voiding the same game again is rejected.
    const repeatVoid = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${gameId}/void`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({}),
        },
      ),
      env,
      execCtx(),
    )
    expect(repeatVoid.status).toBe(409)
  })

  it('stores recognised club names and shows them when no club was selected', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Recognised Clubs Room' }),
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
    const [aliceId, bobId] = gamerIds

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

    // Start the game WITHOUT selecting any FC clubs.
    const currentGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            allocationMode: 'manual',
            homeGamerIds: [aliceId],
            awayGamerIds: [bobId],
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(currentGameRes.status).toBe(201)
    const currentGameBody = (await currentGameRes.json()) as { currentGame: { id: string } }

    // Record the result with club names recognised from the TV photo.
    const recordRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${currentGameBody.currentGame.id}/result`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            result: 'home',
            homeScore: 3,
            awayScore: 0,
            entryMethod: 'ocr',
            ocrModel: 'gemini',
            homeClubName: 'Real Madrid',
            awayClubName: 'Barcelona',
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(recordRes.status).toBe(200)

    const historyRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/match-history?scope=all`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    expect(historyRes.status).toBe(200)
    const history = (await historyRes.json()) as MatchHistoryResponse
    expect(history.matches).toHaveLength(1)
    const match = history.matches[0]!
    // No club was selected, so the id is the 0 sentinel but the recognised
    // name is surfaced for display.
    expect(match.home.clubId).toBe(0)
    expect(match.home.clubName).toBe('Real Madrid')
    expect(match.away.clubId).toBe(0)
    expect(match.away.clubName).toBe('Barcelona')
  })

  it('honors a clubId override on the result so a mismatched OCR name wins', async () => {
    const app = buildTestApp()

    // Seed two real clubs so the squad map can resolve their names.
    await app.squadVersions.insert({
      version: 'fc26-r-override',
      releasedAt: null,
      ingestedAt: 3_000,
      clubsBytes: 1,
      clubCount: 2,
      playerCount: 0,
      sourceUrl: 'https://example.com',
      notes: null,
    })
    await app.squadStorage.putClubs('fc26-r-override', [
      {
        id: 1,
        name: 'Galatasaray',
        shortName: 'GS',
        leagueId: 13,
        leagueName: 'Turkey Süper Lig',
        nationId: 14,
        overallRating: 80,
        attackRating: 83,
        midfieldRating: 80,
        defenseRating: 78,
        avatarUrl: null,
        logoUrl: 'pending:club:1',
        starRating: 9,
      },
      {
        id: 2,
        name: 'Beşiktaş',
        shortName: 'BJK',
        leagueId: 13,
        leagueName: 'Turkey Süper Lig',
        nationId: 14,
        overallRating: 78,
        attackRating: 79,
        midfieldRating: 78,
        defenseRating: 77,
        avatarUrl: null,
        logoUrl: 'pending:club:2',
        starRating: 7,
      },
    ])

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mismatch Room' }),
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
    const [aliceId, bobId] = gamerIds

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

    // Start the game with both clubs picked (1 = Galatasaray, 2 = Beşiktaş).
    const currentGameRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            allocationMode: 'manual',
            homeGamerIds: [aliceId],
            awayGamerIds: [bobId],
            homeClubId: 1,
            awayClubId: 2,
          }),
        },
      ),
      env,
      execCtx(),
    )
    const currentGameBody = (await currentGameRes.json()) as { currentGame: { id: string } }

    // Record the result with the photo's recognised home name diverging from
    // the selected club, and an override that clears the home clubId. The
    // away side keeps its selection — recognised name there is just a
    // fallback label that won't show because the squad name resolves.
    const recordRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/game-nights/${gameNightBody.gameNight.id}/games/${currentGameBody.currentGame.id}/result`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            result: 'home',
            homeScore: 2,
            awayScore: 0,
            entryMethod: 'ocr',
            ocrModel: 'gemini',
            homeClubName: 'Real Madrid',
            awayClubName: 'Beşiktaş',
            homeClubId: null,
          }),
        },
      ),
      env,
      execCtx(),
    )
    expect(recordRes.status).toBe(200)

    const historyRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/match-history?scope=all`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    const history = (await historyRes.json()) as MatchHistoryResponse
    expect(history.matches).toHaveLength(1)
    const match = history.matches[0]!
    // Home: override cleared the selection, recognised name surfaces.
    expect(match.home.clubId).toBe(0)
    expect(match.home.clubName).toBe('Real Madrid')
    // Away: no override, selected club resolves through the squad map.
    expect(match.away.clubId).toBe(2)
    expect(match.away.clubName).toBe('Beşiktaş')
  })

  it('rejects a match-history request with no scope or both scopes', async () => {
    const app = buildTestApp()

    const createRes = await app.fetch(
      new Request('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Scope Room' }),
      }),
      env,
      execCtx(),
    )
    const room = (await createRes.json()) as RoomBootstrapResponse
    const cookie = cookieFrom(createRes)

    const noneRes = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.room.id}/match-history`, {
        headers: { Cookie: cookie },
      }),
      env,
      execCtx(),
    )
    expect(noneRes.status).toBe(400)

    const bothRes = await app.fetch(
      new Request(
        `http://localhost/api/rooms/${room.room.id}/match-history?gamerId=g1&teamKey=gt_g1_g2`,
        { headers: { Cookie: cookie } },
      ),
      env,
      execCtx(),
    )
    expect(bothRes.status).toBe(400)
  })
})

describe('name uniqueness', () => {
  async function makeRoom(app: ReturnType<typeof buildTestApp>, name: string) {
    const res = await app.request(
      '/api/rooms',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) },
      env,
      execCtx(),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { room: { id: string } }
    return { id: body.room.id, cookie: cookieFrom(res) }
  }

  async function addGamer(
    app: ReturnType<typeof buildTestApp>,
    room: { id: string; cookie: string },
    name: string,
  ) {
    return app.request(
      `/api/rooms/${room.id}/gamers`,
      {
        method: 'POST',
        headers: { cookie: room.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      },
      env,
      execCtx(),
    )
  }

  it('lets two rooms each have a gamer of the same name', async () => {
    const app = buildTestApp()
    const first = await makeRoom(app, 'Tuesday Lot')
    const second = await makeRoom(app, 'Thursday Lot')

    expect((await addGamer(app, first, 'Ann')).status).toBe(201)
    // Two groups of friends who never play each other: the second to sign up
    // should not find the ordinary names already gone.
    expect((await addGamer(app, second, 'Ann')).status).toBe(201)
  })

  it('still refuses a duplicate name inside one room', async () => {
    const app = buildTestApp()
    const room = await makeRoom(app, 'Tuesday Lot')

    expect((await addGamer(app, room, 'Ann')).status).toBe(201)
    const again = await addGamer(app, room, 'Ann')
    expect(again.status).toBe(409)
    expect((await again.json()) as { error: string }).toMatchObject({ error: 'gamer_name_taken' })
  })

  it('refuses a rename onto a name another gamer in the room already holds', async () => {
    const app = buildTestApp()
    const room = await makeRoom(app, 'Tuesday Lot')
    await addGamer(app, room, 'Ann')
    const bobRes = await addGamer(app, room, 'Bob')
    const bob = (await bobRes.json()) as { gamer: { id: string } }

    const res = await app.request(
      `/api/rooms/${room.id}/gamers/${bob.gamer.id}`,
      {
        method: 'PATCH',
        headers: { cookie: room.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ann' }),
      },
      env,
      execCtx(),
    )
    expect(res.status).toBe(409)
  })

  it('allows a rename onto a name only another room uses', async () => {
    const app = buildTestApp()
    const first = await makeRoom(app, 'Tuesday Lot')
    const second = await makeRoom(app, 'Thursday Lot')
    await addGamer(app, first, 'Ann')
    const bobRes = await addGamer(app, second, 'Bob')
    const bob = (await bobRes.json()) as { gamer: { id: string } }

    const res = await app.request(
      `/api/rooms/${second.id}/gamers/${bob.gamer.id}`,
      {
        method: 'PATCH',
        headers: { cookie: second.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ann' }),
      },
      env,
      execCtx(),
    )
    expect(res.status).toBe(200)
  })

  it('keeps room names globally unique, because a room is joined by name', async () => {
    const app = buildTestApp()
    await makeRoom(app, 'Tuesday Lot')

    const res = await app.request(
      '/api/rooms',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tuesday Lot' }),
      },
      env,
      execCtx(),
    )
    expect(res.status).toBe(409)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'room_name_taken' })
  })

  it('keeps the room and gamer stem namespace shared, which scoping did not change', async () => {
    const app = buildTestApp()
    const room = await makeRoom(app, 'Tuesday Lot')
    await addGamer(app, room, 'Ann')

    // Rooms are addressed by name, so this pairing stays global in both
    // directions: a room may not take a gamer's name, or a gamer a room's.
    const asRoom = await app.request(
      '/api/rooms',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ann' }),
      },
      env,
      execCtx(),
    )
    expect(asRoom.status).toBe(409)

    const asGamer = await addGamer(app, room, 'Thursday Lot 2')
    expect(asGamer.status).toBe(201)

    const second = await makeRoom(app, 'Wednesday Lot')
    expect((await addGamer(app, second, 'Tuesday Lot')).status).toBe(409)
  })
})
