import type {
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
  session: RoomSessionInfo
}

export interface CreateRoomRequest {
  name: string
  pin?: string | null
  avatarUrl?: string | null
  defaultSelectionStrategy?: string
}

export interface JoinRoomRequest {
  pin?: string | null
}

export interface CreateGamerRequest {
  name: string
  rating?: number
  active?: boolean
  avatarUrl?: string | null
}

export interface UpdateGamerRequest {
  name?: string
  rating?: number
  active?: boolean
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
