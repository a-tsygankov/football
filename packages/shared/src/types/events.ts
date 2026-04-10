import type { EventId, GamerId, GamerTeamKey, GameId, RoomId } from './ids.js'
import type { GameSize } from './domain.js'

/**
 * Event log schema. Versioned because event payloads are stored on disk forever
 * and may be read by code newer than the writer. Always include `schemaVersion`
 * on writes; bump it when you change a payload shape.
 */
export const EVENT_SCHEMA_VERSION = 1 as const

export type EventType = 'game_recorded' | 'game_voided'

export type GameResult = 'home' | 'away' | 'draw'

export interface GameSide {
  /** Length 1 for size=2, length 2 for size=4. */
  gamerIds: readonly GamerId[]
  gamerTeamKey: GamerTeamKey
  clubId: number
  /** Null when only the winner was recorded (no exact score entered). */
  score: number | null
}

export interface GameRecordedEvent {
  type: 'game_recorded'
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  gameId: GameId
  roomId: RoomId
  size: GameSize
  /** When the game was actually played. */
  occurredAt: number
  home: GameSide
  away: GameSide
  result: GameResult
  /** Squad version (R2 directory name) used at draw time. */
  squadVersion: string
  /** Which selection strategy picked the gamers (`'manual'` if hand-picked). */
  selectionStrategyId: string
  entryMethod: 'manual' | 'ocr'
  /** Set only when entryMethod === 'ocr'. */
  ocrModel?: string
}

export interface GameVoidedEvent {
  type: 'game_voided'
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  /** Refers to a previous game_recorded by gameId. */
  gameId: GameId
  roomId: RoomId
  occurredAt: number
  reason: string
}

export type GameEventPayload = GameRecordedEvent | GameVoidedEvent

/** Wire/storage envelope around a payload. Always written by the worker. */
export interface PersistedGameEvent {
  id: EventId
  roomId: RoomId
  eventType: EventType
  payload: GameEventPayload
  schemaVersion: number
  correlationId: string | null
  occurredAt: number
  recordedAt: number
}
