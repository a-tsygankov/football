import type { GamerId, GamerTeamKey, RoomId } from './ids.js'

/** A game is always 2 vs 2 (size=4) or 1 vs 1 (size=2). No other sizes allowed. */
export type GameSize = 2 | 4

export interface Room {
  id: RoomId
  name: string
  /** Null when no PIN is set. */
  pinHash: string | null
  pinSalt: string | null
  defaultSelectionStrategy: string
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
