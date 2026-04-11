import { describe, expect, it } from 'vitest'
import type { RoomBootstrapResponse } from '@fc26/shared'
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

function buildTestApp() {
  const rooms = new InMemoryRoomRepository()
  const gamers = new InMemoryGamerRepository()
  const games = new InMemoryGameRepository()
  const gameNights = new InMemoryGameNightRepository()
  const pinAttempts = new InMemoryPinAttemptRepository()
  const squadStorage = new InMemorySquadStorage()
  const squadVersions = new InMemorySquadVersionRepository()
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
  return app
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
})
