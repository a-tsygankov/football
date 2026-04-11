import { describe, expect, it } from 'vitest'
import type { RoomBootstrapResponse } from '@fc26/shared'
import { buildApp } from '../app.js'
import {
  InMemoryPinAttemptRepository,
} from '../auth/pin-attempt-repository.js'
import type { Env } from '../env.js'
import { InMemoryGamerRepository } from '../gamers/repository.js'
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
  const gameNights = new InMemoryGameNightRepository()
  const pinAttempts = new InMemoryPinAttemptRepository()
  const squadStorage = new InMemorySquadStorage()
  const squadVersions = new InMemorySquadVersionRepository()
  const app = buildApp({
    dependencies: () => ({
      rooms,
      gamers,
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
  })
})
