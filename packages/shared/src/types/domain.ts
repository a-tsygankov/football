import type {
  GameId,
  GameNightId,
  GamerId,
  GamerTeamKey,
  RoomId,
} from './ids.js'

export type GameSideSize = 1 | 2
export type GameFormat = '1v1' | '1v2' | '2v1' | '2v2'
export type GameSize = 2 | 3 | 4
export type GameAllocationMode = 'manual' | 'random'
export type GameStatus = 'active' | 'recorded' | 'interrupted' | 'voided'

export interface GameFormatDefinition {
  id: GameFormat
  label: string
  homeSize: GameSideSize
  awaySize: GameSideSize
  size: GameSize
}

export type SquadPlatform = 'PS5' | 'PC64' | 'XBSX'

export interface SquadPlatformDefinition {
  id: SquadPlatform
  label: string
}

export const DEFAULT_SQUAD_PLATFORM: SquadPlatform = 'PS5'

export const SQUAD_PLATFORMS: Readonly<Record<SquadPlatform, SquadPlatformDefinition>> = {
  PS5: { id: 'PS5', label: 'PlayStation 5' },
  PC64: { id: 'PC64', label: 'PC' },
  XBSX: { id: 'XBSX', label: 'Xbox Series X|S' },
} as const

export const GAME_FORMATS: Readonly<Record<GameFormat, GameFormatDefinition>> = {
  '1v1': { id: '1v1', label: '1 vs 1', homeSize: 1, awaySize: 1, size: 2 },
  '1v2': { id: '1v2', label: '1 vs 2', homeSize: 1, awaySize: 2, size: 3 },
  '2v1': { id: '2v1', label: '2 vs 1', homeSize: 2, awaySize: 1, size: 3 },
  '2v2': { id: '2v2', label: '2 vs 2', homeSize: 2, awaySize: 2, size: 4 },
} as const

export function inferGameFormat(
  homeSize: number,
  awaySize: number,
): GameFormat | null {
  const format = `${homeSize}v${awaySize}` as GameFormat
  return format in GAME_FORMATS ? format : null
}

export interface Room {
  id: RoomId
  name: string
  nameKey: string
  avatarUrl: string | null
  /** Null when no PIN is set. */
  pinHash: string | null
  pinSalt: string | null
  defaultSelectionStrategy: string
  squadPlatform: SquadPlatform
  createdAt: number
  updatedAt: number
}

export interface RoomSummary {
  id: RoomId
  name: string
  avatarUrl: string | null
  hasPin: boolean
  defaultSelectionStrategy: string
  squadPlatform: SquadPlatform
  createdAt: number
  updatedAt: number
}

export interface Gamer {
  id: GamerId
  roomId: RoomId
  name: string
  /** 1..5, used by some selection strategies and rated-random side assignment. */
  rating: number
  active: boolean
  hasPin: boolean
  avatarUrl: string | null
  createdAt: number
  updatedAt: number
}

export type GameNightStatus = 'active' | 'completed'

export interface GameNight {
  id: GameNightId
  roomId: RoomId
  status: GameNightStatus
  startedAt: number
  endedAt: number | null
  lastGameAt: number | null
  createdAt: number
  updatedAt: number
}

export interface GameNightActiveGamer {
  gameNightId: GameNightId
  roomId: RoomId
  gamerId: GamerId
  joinedAt: number
  updatedAt: number
}

export interface CurrentGame {
  id: GameId
  roomId: RoomId
  gameNightId: GameNightId
  status: GameStatus
  allocationMode: GameAllocationMode
  format: GameFormat
  homeGamerIds: readonly GamerId[]
  awayGamerIds: readonly GamerId[]
  selectionStrategyId: string
  randomSeed: number | null
  createdAt: number
  updatedAt: number
}

export interface GamerPoints {
  gamerId: GamerId
  roomId: RoomId
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  lastEventId: string
  updatedAt: number
}

export interface GamerTeamPoints {
  gamerTeamKey: GamerTeamKey
  roomId: RoomId
  /** Sorted gamer IDs that compose this team, for display. */
  members: readonly GamerId[]
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  lastEventId: string
  updatedAt: number
}
