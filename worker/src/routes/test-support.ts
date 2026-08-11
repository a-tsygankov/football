import { expect } from 'vitest'
import { buildApp } from '../app.js'
import {
  InMemoryPinAttemptRepository,
} from '../auth/pin-attempt-repository.js'
import type { Env } from '../env.js'
import { InMemoryGameEventRepository } from '../events/repository.js'
import { InMemoryGamerRepository } from '../gamers/repository.js'
import { InMemoryGameRepository } from '../games/repository.js'
import { InMemoryGameNightRepository } from '../game-nights/repository.js'
import { InMemoryBetRepository } from '../bets/repository.js'
import { InMemoryGameProjectionRepository } from '../projections/repository.js'
import { InMemoryRoomRepository } from '../rooms/repository.js'
import { InMemorySquadStorage } from '../squad/in-memory-storage.js'
import { InMemorySquadVersionRepository } from '../squad/version-repository.js'

export const env: Env = {
  WORKER_VERSION: '0.1.0-test',
  SCHEMA_VERSION: '1',
  MIN_CLIENT_VERSION: '0.1.0',
  SESSION_SECRET: 'test-session-secret',
}

export function execCtx(): ExecutionContext {
  return {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext
}

export function buildTestApp() {
  const rooms = new InMemoryRoomRepository()
  const gamers = new InMemoryGamerRepository()
  const games = new InMemoryGameRepository()
  const events = new InMemoryGameEventRepository()
  const projections = new InMemoryGameProjectionRepository()
  const gameNights = new InMemoryGameNightRepository()
  const pinAttempts = new InMemoryPinAttemptRepository()
  const squadStorage = new InMemorySquadStorage()
  const squadVersions = new InMemorySquadVersionRepository()
  const bets = new InMemoryBetRepository()
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
      bets,
    }),
  })
  return Object.assign(app, {
    squadStorage,
    squadVersions,
    games,
    events,
    bets,
  })
}

export function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie')
  expect(raw).toBeTruthy()
  return raw!.split(';')[0]!
}

/**
 * Every worker route test drives the app through `app.fetch(new Request(...))`
 * — Hono's `app.request` shorthand does not take the `env` and
 * `ExecutionContext` arguments these routes need. This wrapper keeps that
 * shape in one place.
 */
export async function req(
  app: ReturnType<typeof buildTestApp>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init), env, execCtx())
}

function jsonInit(cookie: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  }
}

export async function createGamer(
  app: ReturnType<typeof buildTestApp>,
  roomId: string,
  cookie: string,
  name: string,
): Promise<string> {
  const res = await req(app, `/api/rooms/${roomId}/gamers`, jsonInit(cookie, { name }))
  const body = (await res.json()) as { gamer: { id: string } }
  return body.gamer.id
}

export interface LiveGameSeed {
  roomId: string
  nightId: string
  gameId: string
  /** Home side. */
  ann: string
  /** Away side. */
  bob: string
  /** In the pool but not playing, so it may back any outcome. */
  cy: string
  cookie: string
}

/**
 * Room + three gamers, all three in the night's pool, with a live 1v1 between
 * ann (home) and bob (away). cy sits out, which is what makes it possible to
 * test both the participant and non-participant betting rules.
 */
export async function seedLiveGame(
  app: ReturnType<typeof buildTestApp>,
): Promise<LiveGameSeed> {
  const createRes = await req(app, '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Wager Night' }),
  })
  const room = (await createRes.json()) as { room: { id: string } }
  const roomId = room.room.id
  const cookie = cookieFrom(createRes)

  const ann = await createGamer(app, roomId, cookie, 'Ann')
  const bob = await createGamer(app, roomId, cookie, 'Bob')
  const cy = await createGamer(app, roomId, cookie, 'Cyd')

  const nightRes = await req(
    app,
    `/api/rooms/${roomId}/game-nights`,
    jsonInit(cookie, { activeGamerIds: [ann, bob, cy] }),
  )
  const night = (await nightRes.json()) as { gameNight: { id: string } }
  const nightId = night.gameNight.id

  const gameRes = await req(
    app,
    `/api/rooms/${roomId}/game-nights/${nightId}/games`,
    jsonInit(cookie, {
      allocationMode: 'manual',
      homeGamerIds: [ann],
      awayGamerIds: [bob],
    }),
  )
  const game = (await gameRes.json()) as { currentGame: { id: string } }

  return { roomId, nightId, gameId: game.currentGame.id, ann, bob, cy, cookie }
}

export async function placeBet(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
  gamerId: string,
  outcome: 'home' | 'away' | 'draw',
  stake: number,
): Promise<Response> {
  return req(
    app,
    `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/bets`,
    jsonInit(seed.cookie, { gamerId, outcome, stake }),
  )
}

export async function recordResult(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
  body: { result: 'home' | 'away' | 'draw'; homeScore?: number; awayScore?: number },
): Promise<Response> {
  return req(
    app,
    `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/result`,
    jsonInit(seed.cookie, body),
  )
}
