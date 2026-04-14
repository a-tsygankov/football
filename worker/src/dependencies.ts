import type { Env } from './env.js'
import {
  D1GamerRepository,
  InMemoryGamerRepository,
  type IGamerRepository,
} from './gamers/repository.js'
import {
  D1GameEventRepository,
  InMemoryGameEventRepository,
  type IGameEventRepository,
} from './events/repository.js'
import {
  D1GameRepository,
  InMemoryGameRepository,
  type IGameRepository,
} from './games/repository.js'
import {
  D1GameNightRepository,
  InMemoryGameNightRepository,
  type IGameNightRepository,
} from './game-nights/repository.js'
import {
  D1GameProjectionRepository,
  InMemoryGameProjectionRepository,
  type IGameProjectionRepository,
} from './projections/repository.js'
import {
  D1PinAttemptRepository,
  InMemoryPinAttemptRepository,
  type IPinAttemptRepository,
} from './auth/pin-attempt-repository.js'
import {
  D1RoomRepository,
  InMemoryRoomRepository,
  type IRoomRepository,
} from './rooms/repository.js'
import { InMemorySquadStorage } from './squad/in-memory-storage.js'
import { R2SquadStorage } from './squad/r2-storage.js'
import {
  D1SquadVersionRepository,
  InMemorySquadVersionRepository,
  type ISquadVersionRepository,
} from './squad/version-repository.js'
import type { ISquadStorage } from './squad/storage.js'

const inMemoryFallbacks = {
  rooms: new InMemoryRoomRepository(),
  gamers: new InMemoryGamerRepository(),
  games: new InMemoryGameRepository(),
  events: new InMemoryGameEventRepository(),
  projections: new InMemoryGameProjectionRepository(),
  gameNights: new InMemoryGameNightRepository(),
  pinAttempts: new InMemoryPinAttemptRepository(),
  squadStorage: new InMemorySquadStorage(),
  squadVersions: new InMemorySquadVersionRepository(),
} as const

/**
 * The composition root for Worker dependencies.
 *
 * Routes never construct R2/D1 directly. They get an `AppDependencies` from
 * the Hono context, populated by `buildApp()` from the env on every request
 * (or by tests with in-memory fakes).
 */
export interface AppDependencies {
  readonly rooms: IRoomRepository
  readonly gamers: IGamerRepository
  readonly games: IGameRepository
  readonly events: IGameEventRepository
  readonly projections: IGameProjectionRepository
  readonly gameNights: IGameNightRepository
  readonly pinAttempts: IPinAttemptRepository
  readonly squadStorage: ISquadStorage
  readonly squadVersions: ISquadVersionRepository
}

/**
 * Builds the production dependency graph from a Worker `Env`. Falls back to
 * in-memory implementations when bindings are not configured (Phase 0 boot,
 * or when the developer is running `wrangler dev` without R2/D1 set up).
 *
 * The fallbacks let the scaffold respond to `/api/version` and `/api/health`
 * without erroring; they're never used in production where bindings exist.
 */
export function buildDependencies(env: Env): AppDependencies {
  return {
    rooms: env.DB ? new D1RoomRepository(env.DB) : inMemoryFallbacks.rooms,
    gamers: env.DB ? new D1GamerRepository(env.DB) : inMemoryFallbacks.gamers,
    games: env.DB ? new D1GameRepository(env.DB) : inMemoryFallbacks.games,
    events: env.DB ? new D1GameEventRepository(env.DB) : inMemoryFallbacks.events,
    projections: env.DB
      ? new D1GameProjectionRepository(env.DB)
      : inMemoryFallbacks.projections,
    gameNights: env.DB
      ? new D1GameNightRepository(env.DB)
      : inMemoryFallbacks.gameNights,
    pinAttempts: env.DB
      ? new D1PinAttemptRepository(env.DB)
      : inMemoryFallbacks.pinAttempts,
    squadStorage: env.SQUADS
      ? new R2SquadStorage(env.SQUADS)
      : inMemoryFallbacks.squadStorage,
    squadVersions: env.DB
      ? new D1SquadVersionRepository(env.DB)
      : inMemoryFallbacks.squadVersions,
  }
}
