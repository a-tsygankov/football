import type {
  CurrentGame,
  GameFormat,
  GameNight,
  GameNightActiveGamer,
  Gamer,
  RoomSummary,
} from './domain.js'
import type { RoomId } from './ids.js'

export interface RoomSessionInfo {
  roomId: RoomId
  expiresAt: number
}

export interface RoomBootstrapResponse {
  room: RoomSummary
  gamers: ReadonlyArray<Gamer>
  activeGameNight: GameNight | null
  activeGameNightGamers: ReadonlyArray<GameNightActiveGamer>
  currentGame: CurrentGame | null
  session: RoomSessionInfo
}

export interface CreateRoomRequest {
  name: string
  pin?: string | null
  avatarUrl?: string | null
  defaultSelectionStrategy?: string
}

export interface JoinRoomRequest {
  identifier?: string
  pin?: string | null
}

export interface CreateGamerRequest {
  name: string
  rating?: number
  active?: boolean
  pin?: string | null
  avatarUrl?: string | null
}

export interface UpdateGamerRequest {
  name?: string
  rating?: number
  active?: boolean
  currentPin?: string | null
  pin?: string | null
  avatarUrl?: string | null
}

export interface GamerResponse {
  gamer: Gamer
}

export interface CreateGameNightRequest {
  activeGamerIds?: ReadonlyArray<string>
}

export interface GameNightResponse {
  gameNight: GameNight
  activeGamers: ReadonlyArray<GameNightActiveGamer>
}

export interface UpdateGameNightActiveGamersRequest {
  activeGamerIds: ReadonlyArray<string>
}

export interface CreateCurrentGameManualRequest {
  allocationMode: 'manual'
  homeGamerIds: ReadonlyArray<string>
  awayGamerIds: ReadonlyArray<string>
}

export interface CreateCurrentGameRandomRequest {
  allocationMode: 'random'
  format: GameFormat
  selectionStrategyId?: string
}

export type CreateCurrentGameRequest =
  | CreateCurrentGameManualRequest
  | CreateCurrentGameRandomRequest

export interface CurrentGameResponse {
  currentGame: CurrentGame
}
