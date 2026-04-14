import type {
  CurrentGame,
  GameFormat,
  GameNight,
  GameNightActiveGamer,
  Gamer,
  GamerPoints,
  GamerTeamPoints,
  RoomSummary,
} from './domain.js'
import type { GameResult } from './events.js'
import type { RoomId } from './ids.js'
import type { SquadAssetRefreshResult, SquadResetResult, SquadSyncResult } from './squad.js'

export interface RoomSessionInfo {
  roomId: RoomId
  expiresAt: number
  token?: string
}

export const ROOM_SESSION_HEADER = 'x-fc26-room-session'

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

export interface RecordCurrentGameResultRequest {
  result: GameResult
  homeScore?: number | null
  awayScore?: number | null
  occurredAt?: number
}

export interface InterruptCurrentGameRequest {
  comment?: string | null
  occurredAt?: number
}

export interface ResolveCurrentGameResponse {
  currentGame: CurrentGame | null
  activeGameNight: GameNight
  eventId: string
  eventType: 'game_recorded' | 'game_interrupted'
}

export interface GamerScoreboardRow {
  gamer: Gamer
  stats: GamerPoints
  points: number
  winRate: number
  goalDiff: number
}

export interface GamerTeamScoreboardRow {
  gamerTeamKey: string
  members: ReadonlyArray<Gamer>
  stats: GamerTeamPoints
  points: number
  winRate: number
  goalDiff: number
}

export interface RoomScoreboardResponse {
  roomId: RoomId
  gamerRows: ReadonlyArray<GamerScoreboardRow>
  gamerRowsWithoutTeamGames: ReadonlyArray<GamerScoreboardRow>
  gamerTeamRows: ReadonlyArray<GamerTeamScoreboardRow>
  updatedAt: number | null
}

export interface RefreshRoomSquadAssetsResponse {
  result: SquadAssetRefreshResult
}

export interface RetrieveRoomSquadsResponse {
  result: SquadSyncResult
}

export interface ResetRoomSquadsResponse {
  result: SquadResetResult
}
